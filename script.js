// Generate random room name if needed
if (!location.hash) {
  location.hash = Math.floor(Math.random() * 0xffffff).toString(16);
}
const roomHash = location.hash.substring(1);

// TODO: Replace with your own channel ID
const drone = new ScaleDrone('Dj5rcW4BTN6QvIsx');
// Room name needs to be prefixed with 'observable-'
const roomName = 'observable-' + roomHash;
const configuration = {
  iceServers: [
    {
      urls: 'stun:stun.l.google.com:19302',
    },
  ],
};
let room;
let pc;
let isMuted = false;
let isCameraOn = true; // Track camera on/off state
let isScreenSharing = false; // Track screen sharing state
let isRecording = false; // Track recording state
let mediaRecorder; // MediaRecorder instance for video recording
let recordedChunks = []; // Array to store recorded video chunks
let remoteStreams = {};
let participantCount = 1; // Set to 1 for the local participant

// Get DOM elements
const localVideo = document.getElementById('localVideo');
const remoteVideosContainer = document.getElementById('remoteVideosContainer');
const leaveButton = document.getElementById('leaveButton');
const muteButton = document.getElementById('muteButton');
const cameraButton = document.getElementById('cameraButton'); // Camera on/off button
const screenShareButton = document.getElementById('screenShareButton'); // Screen share button
const recordButton = document.getElementById('recordButton'); // Video record button
const copyUrlButton = document.getElementById('copyUrlButton');
const zoomButton = document.getElementById('zoomButton');

leaveButton.addEventListener('click', leaveCall);
muteButton.addEventListener('click', toggleMute);
cameraButton.addEventListener('click', toggleCamera);
screenShareButton.addEventListener('click', toggleScreenSharing); // Add event listener for screen sharing
recordButton.addEventListener('click', toggleRecording); // Add event listener for video recording
copyUrlButton.addEventListener('click', copyUrl);
zoomButton.addEventListener('click', toggleZoom);

function leaveCall() {
  if (room) {
    room.unsubscribe();
  }
  if (pc) {
    pc.close();
  }
  localVideo.srcObject = null;
  removeRemoteStreams();
  // Remove the local video window
  localVideo.remove();
  // Broadcast the participant's departure
  sendMessage({ left: true });
  participantCount--; // Decrement the participant count
}

function toggleMute() {
  if (pc && pc.getSenders().length > 0) {
    isMuted = !isMuted;
    pc.getSenders().forEach((sender) => {
      if (sender.track.kind === 'audio') {
        sender.track.enabled = !isMuted;
      }
    });
    muteButton.textContent = isMuted ? 'Unmute' : 'Mute';
  }
}

function toggleCamera() {
  if (pc && pc.getSenders().length > 0) {
    isCameraOn = !isCameraOn;
    pc.getSenders().forEach((sender) => {
      if (sender.track.kind === 'video') {
        sender.track.enabled = isCameraOn;
      }
    });
    cameraButton.textContent = isCameraOn ? 'Camera Off' : 'Camera On';
  }
}

function toggleScreenSharing() {
  if (!isScreenSharing) {
    startScreenSharing();
  } else {
    stopScreenSharing();
  }
}

function startScreenSharing() {
  navigator.mediaDevices
    .getDisplayMedia({ video: true })
    .then((stream) => {
      const videoTrack = stream.getVideoTracks()[0];
      const sender = pc.getSenders().find((s) => s.track.kind === 'video');

      if (sender) {
        sender.replaceTrack(videoTrack);
      } else {
        pc.addTrack(videoTrack, stream);
      }

      isScreenSharing = true;
      screenShareButton.textContent = 'Stop Sharing';
    })
    .catch((error) => {
      console.error('Error starting screen sharing:', error);
    });
}

function stopScreenSharing() {
  const sender = pc.getSenders().find((s) => s.track.kind === 'video');

  if (sender && sender.track) {
    const cameraStream = localVideo.srcObject;
    sender.replaceTrack(cameraStream.getVideoTracks()[0]);
  }

  isScreenSharing = false;
  screenShareButton.textContent = 'Share Screen';
}

function toggleRecording() {
  if (!isRecording) {
    startRecording();
  } else {
    stopRecording();
  }
}

function startRecording() {
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(localVideo.srcObject);

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recording.webm';
    a.click();
    URL.revokeObjectURL(url);
  };

  mediaRecorder.start();
  isRecording = true;
  recordButton.textContent = 'Stop Recording';
  showRecordingTimer();
}

function stopRecording() {
  mediaRecorder.stop();
  isRecording = false;
  recordButton.textContent = 'Start Recording';
  hideRecordingTimer();
}

function showRecordingTimer() {
  const recordingTimer = document.getElementById('recordingTimer');
  recordingTimer.style.display = 'block';

  let seconds = 0;
  let minutes = 0;

  const timerInterval = setInterval(() => {
    seconds++;
    if (seconds >= 60) {
      seconds = 0;
      minutes++;
    }
    recordingTimer.textContent = `${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }, 1000);

  recordButton.dataset.timerInterval = timerInterval;
}

function hideRecordingTimer() {
  const recordingTimer = document.getElementById('recordingTimer');
  recordingTimer.style.display = 'none';

  const timerInterval = recordButton.dataset.timerInterval;
  clearInterval(timerInterval);
}

function copyUrl() {
  const urlInput = document.createElement('input');
  urlInput.value = window.location.href;
  document.body.appendChild(urlInput);
  urlInput.select();
  document.execCommand('copy');
  document.body.removeChild(urlInput);
}

function onSuccess() {}

function onError(error) {
  console.error(error);
}

drone.on('open', (error) => {
  if (error) {
    return console.error(error);
  }
  room = drone.subscribe(roomName);
  room.on('open', (error) => {
    if (error) {
      onError(error);
    }
  });
  room.on('members', (members) => {
    console.log('MEMBERS', members);
    const isOfferer = members.length > 1;
    if (members.length > 2) {
      console.log('Maximum participant limit reached. Unable to join.');
      return;
    }
    participantCount = members.length;
    startWebRTC(isOfferer);
  });
});

function sendMessage(message) {
  drone.publish({
    room: roomName,
    message,
  });
}

function updateVideoContainer() {
  const numParticipants = Object.keys(remoteStreams).length + 1;
  const numCols = Math.min(numParticipants, 2);
  const numRows = Math.ceil(numParticipants / numCols);

  remoteVideosContainer.style.gridTemplateColumns = `repeat(${numCols}, 1fr)`;
  remoteVideosContainer.style.gridTemplateRows = `repeat(${numRows}, 1fr)`;
}

function startWebRTC(isOfferer) {
  if (participantCount > 2) {
    console.log(
      'Maximum participant limit reached. Unable to start video connection.'
    );
    sendMessage({ limitReached: true });
    return;
  }

  pc = new RTCPeerConnection(configuration);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendMessage({ candidate: event.candidate });
    }
  };

  if (isOfferer) {
    pc.onnegotiationneeded = () => {
      pc.createOffer().then(localDescCreated).catch(onError);
    };
  }

  pc.ontrack = (event) => {
    const streamId = event.streams[0].id;
    if (!remoteStreams[streamId]) {
      remoteStreams[streamId] = event.streams[0];
      const remoteVideo = document.createElement('video');
      remoteVideo.autoplay = true;
      remoteVideo.srcObject = event.streams[0];
      remoteVideosContainer.appendChild(remoteVideo);
      updateVideoContainer();
    }
  };

  pc.onremovestream = (event) => {
    const streamId = event.stream.id;
    if (remoteStreams[streamId]) {
      delete remoteStreams[streamId];
      const remoteVideo = remoteVideosContainer.querySelector(
        `[srcObject="${streamId}"]`
      );
      if (remoteVideo) {
        remoteVideo.remove();
        updateVideoContainer();
      }
    }
    // Call the removeRemoteStreams() function to update the grid layout
    removeRemoteStreams();
    participantCount--; // Decrement the participant count
  };

  navigator.mediaDevices
    .getUserMedia({
      audio: true,
      video: true,
    })
    .then((stream) => {
      localVideo.srcObject = stream;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    })
    .catch(onError);

  room.on('data', (message, client) => {
    if (client.id === drone.clientId) {
      return;
    }

    if (message.sdp) {
      pc.setRemoteDescription(
        new RTCSessionDescription(message.sdp),
        () => {
          if (pc.remoteDescription.type === 'offer') {
            pc.createAnswer().then(localDescCreated).catch(onError);
          }
        },
        onError
      );
    } else if (message.candidate) {
      pc.addIceCandidate(
        new RTCIceCandidate(message.candidate),
        onSuccess,
        onError
      );
    } else if (message.left) {
      // Remove the video window of the participant who left from all users
      const streamId = client.id;
      if (remoteStreams[streamId]) {
        delete remoteStreams[streamId];
        const remoteVideo = remoteVideosContainer.querySelector(
          `[srcObject="${streamId}"]`
        );
        if (remoteVideo) {
          remoteVideo.remove();
          updateVideoContainer();
        }
      }
      participantCount--; // Decrement the participant count
    }
  });
}

function localDescCreated(desc) {
  pc.setLocalDescription(
    desc,
    () => sendMessage({ sdp: pc.localDescription }),
    onError
  );
}

function removeRemoteStreams() {
  for (let streamId in remoteStreams) {
    if (remoteStreams.hasOwnProperty(streamId)) {
      const remoteVideo = remoteVideosContainer.querySelector(
        `[srcObject="${streamId}"]`
      );
      if (remoteVideo) {
        remoteVideo.remove();
      }
    }
  }
  remoteStreams = {};
  updateVideoContainer();
}

let isZoomed = false;
let zoomScale = 1;

zoomButton.addEventListener('click', toggleZoom);

function toggleZoom() {
  isZoomed = !isZoomed;

  if (isZoomed) {
    zoomButton.textContent = 'Zoom Out';
    zoomScale = 1.2; // Set the zoom scale to enlarge the window
  } else {
    zoomButton.textContent = 'Zoom In';
    zoomScale = 1; // Set the zoom scale to reset the window size
  }

  adjustWindowSizes();
}

function adjustWindowSizes() {
  localVideo.style.transform = `scale(${zoomScale})`;
  remoteVideosContainer.style.transform = `scale(${zoomScale})`;
}

const darkModeButton = document.getElementById('darkModeButton');

darkModeButton.addEventListener('click', toggleDarkMode);

function toggleDarkMode() {
  document.body.classList.toggle('dark-mode');
}

// Initialize camera button state and text
cameraButton.textContent = isCameraOn ? 'Camera Off' : 'Camera On';

// Initialize screen sharing button state and text
screenShareButton.textContent = isScreenSharing
  ? 'Stop Sharing'
  : 'Share Screen';

// Initialize record button state and text
recordButton.textContent = isRecording ? 'Stop Recording' : 'Start Recording';

function showRecordingTimer() {
  const recordingTimer = document.getElementById('recordingTimer');
  recordingTimer.style.display = 'block';

  let seconds = 0;
  let minutes = 0;

  const timerInterval = setInterval(() => {
    seconds++;
    if (seconds >= 60) {
      seconds = 0;
      minutes++;
    }
    recordingTimer.textContent = `${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }, 1000);

  recordButton.dataset.timerInterval = timerInterval;
}
let lastTapTime = 0;

// ...

const fullScreenButton = document.getElementById('fullScreenButton');
fullScreenButton.addEventListener('click', toggleFullScreen);

// ...

function toggleFullScreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch((error) => {
      console.error('Error entering fullscreen mode:', error);
    });
    fullScreenButton.textContent = 'Minimize';
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch((error) => {
        console.error('Error exiting fullscreen mode:', error);
      });
      fullScreenButton.textContent = 'Full Screen';
    }
  }
}

// ...

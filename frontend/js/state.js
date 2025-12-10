export const state = {
    ws: null,
    myId: null,
    myUsername: null,
    peerConnections: {}, // { userId: { pc, dataChannel, ... } }
    localStream: null,
    selectedUserId: null,
    selectedUsername: null,
    messageHistory: {}, // { userId: [ {text, isSent, timestamp, isFile, fileUrl}, ... ] }
    unreadCounts: {},   // { userId: number }
    currentUsers: [],
    incomingFile: null,
    fileChunks: [],
    incomingFileFrom: null,
    incomingCallInfo: null,
    expectingCall: false,
    pendingCallVideo: false,
    isInCall: false, // New state to track call status
    statsInterval: null
};

export const config = {
    iceServers: [
      {
        urls: "stun:stun.l.google.com:19302",
      },
      {
        urls: "turn:global.relay.metered.ca:80",
        username: "24d95e537cd2acc083268cdb",
        credential: "O9Mo4JnvwlmyxXJA",
      },
      {
        urls: "turn:global.relay.metered.ca:80?transport=tcp",
        username: "24d95e537cd2acc083268cdb",
        credential: "O9Mo4JnvwlmyxXJA",
      },
      {
        urls: "turn:global.relay.metered.ca:443",
        username: "24d95e537cd2acc083268cdb",
        credential: "O9Mo4JnvwlmyxXJA",
      },
      {
        urls: "turns:global.relay.metered.ca:443?transport=tcp",
        username: "24d95e537cd2acc083268cdb",
        credential: "O9Mo4JnvwlmyxXJA",
      },
    ],
};

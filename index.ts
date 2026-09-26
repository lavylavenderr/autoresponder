// Typing

interface WebsocketMessage {
  op: number;
  d: any;
  t: any;
  s: number;
}

interface Dictionary {
  op: number;
  handler(data?: WebsocketMessage): Promise<void> | void;
}

// Variables to track websocket state

let websocketConn: WebSocket | null = null;
let lastSequenceNumber: number | null = null;
let isReconnecting: boolean = false;

let sendLastHeartbeat: boolean = false;
let heartbeatLoop: NodeJS.Timeout | undefined;

let resumeGatewayUrl: string;
let sessionId: string;

let replayInProgress: boolean = false;
let lastHeartbeatAck: boolean = false;

// Required Stuff

const initalHandshakePayload = {
  token: Bun.env.DISCORD_TOKEN, // i will replace with a env eventually
  capabilities: 1767421,
  properties: {
    os: "Linux",
    broswer: "FirefoxUwu",
    system_locale: "en-US",
    browser_user_agent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:156.0) Gecko/20100101 FirefoxUwu/621.0",
    browser_version: "621.0",
    release_channel: "stable",
  },
  client_state: {
    guild_versions: {},
  },
};

// Table of Codes to Expect/How To Handle + Additional Info

const primaryGateway = "wss://gateway.discord.gg/?encoding=json&v=9"; // yes i should get this from the endpoint, no, i don't care
const allowedReconnectCodes = [4000, 4003, 4009];

const dictionary: Dictionary[] = [
  {
    op: 10,
    handler: (data: WebsocketMessage) => {
      sendHeartbeat();
      heartbeatLoop = setInterval(() => {
        sendHeartbeat();
      }, data.d.heartbeat_interval);
    },
  },
  {
    op: 11, // ack to heartbeat
    handler: () => {
      lastHeartbeatAck = true;
      sendLastHeartbeat = false;
    },
  },
  {
    op: 1, // they want a heartbeat back,
    handler: () => {
      sendHeartbeat();
    },
  },
  {
    op: 7, // reconnect requested
    handler: () => {
      initateReconnect();
    },
  },
  {
    op: 6, // replay of events is done (dont process during this)
    handler: () => {
      replayInProgress = false; // we're all caught up after a disconnect!
    },
  },
  {
    op: 9, // figure it out..?
    handler: (data: WebsocketMessage) => {
      if (data.d == true) initateReconnect();
      else {
        if (!isReconnecting) return;

        clearTimeout(heartbeatLoop);
        heartbeatLoop = undefined;

        replayInProgress = false;
        websocketConn?.close(1000);
        websocketConn = null;

        initateConnection();
      }
    },
  },
  {
    op: 0, // main handler
    handler: async (data: WebsocketMessage) => {
      if (isReconnecting) isReconnecting = false;
      lastSequenceNumber = data.s;
      data.t === "READY" &&
        (resumeGatewayUrl = data.d.resume_gateway_url) &
          (sessionId = data.d.session_id);

    //   if (data.t === "MESSAGE_CREATE") { // IGNORE THIS, i was testing :)
    //     console.log(data.d.content.toLowerCase())
    //     if (data.d.content.toLowerCase() === "is it lavvy or is it a program" ) {
    //         console.log("i trigger")
    //         const request = await fetch(`https://discord.com/api/v9/channels/${data.d.channel_id}/messages`, {
    //             body: JSON.stringify({
    //                 content: "well idk :3",
    //                 tts: false,
    //                 flags: 0,
    //                 message_reference: {
    //                     channel_id: data.d.channel_id,
    //                     message_id: data.d.id
    //                 }
    //             }),
    //             method: "POST",
    //             headers: {
    //                 Authorization: Bun.env.DISCORD_TOKEN,
    //                 "Content-Type": "application/json"
    //             }
    //         })
    //         console.log(request.status)
    //         console.log(JSON.stringify(await request.json))
    //     }
    //   }
    },
  },
];

// Helper Functions

function initateReconnect() {
  clearTimeout(heartbeatLoop);
  heartbeatLoop = undefined;

  isReconnecting = true;
  websocketConn?.close(1002);
  websocketConn = null;

  initateConnection(resumeGatewayUrl);
}

function initateInitalHandshake() {
  websocketConn!.send(
    JSON.stringify({
      op: 2,
      d: initalHandshakePayload,
    }),
  );
}

function sendReconnectHandshake() {
  replayInProgress = true;
  websocketConn!.send(
    JSON.stringify({
      op: 6,
      d: {
        token: Bun.env.DISCORD_TOKEN,
        session_id: sessionId,
        seq: lastSequenceNumber,
      },
    }),
  );
}

function sendHeartbeat() {
  websocketConn!.send(
    JSON.stringify({
      op: 1,
      d: lastSequenceNumber ?? null,
    }),
  );

  lastHeartbeatAck = false;
  sendLastHeartbeat = true;
}

// Connect

function initateConnection(url?: string) {
  websocketConn = new WebSocket(url || primaryGateway);

  websocketConn.addEventListener(
    "open",
    !url ? initateInitalHandshake : sendReconnectHandshake,
  );
  websocketConn.addEventListener("message", async (message) => {
    const data = JSON.parse(message.data) as WebsocketMessage;
    const object = dictionary.find((x) => x.op === data.op);
    await object?.handler(data);
  });

  websocketConn.addEventListener("close", (event) => {
    if (!event.code || allowedReconnectCodes.includes(event.code)) {
      isReconnecting = true;
      initateConnection(resumeGatewayUrl);
    }
  });
}

// Initiate the Loop

initateConnection();

// Gracefully exit so there aren't stale sessions

process.on("SIGINT", () => {
  if (websocketConn && websocketConn.readyState === 1) {
    console.log("graefully closing websocket connection!!");
    clearTimeout(heartbeatLoop);
    heartbeatLoop = undefined;

    websocketConn.close(1000);
  }
  process.exit();
});

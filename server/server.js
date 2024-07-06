import express from "express";
import { Server } from "socket.io";
import mediasoup from "mediasoup";

import https from "https";
import cors from "cors";
import fs from "fs";

const app = express();

const option = {
  key: fs.readFileSync("server.key"),
  cert: fs.readFileSync("ssl.cert"),
};
const server = https.createServer(option, app);

const allowedHeaders = [
  "https://localhost:3000",
  "https://192.168.220.186:3000",
  "https://192.168.220.186:3300",
];

// socket
const io = new Server(server, {
  cors: {
    origin: allowedHeaders,
  },
});

app.use(
  cors({
    origin: function (origin, callback) {
      if (allowedHeaders.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by cors."));
      }
    },
  })
);

app.get("/", (req, res) => {
  res.send("SFU Architecture.");
});

server.listen(3300, "192.168.220.186", () => {
  console.log("Server running on port 3300");
});

// mediasoup variables
let worker;
let router;
let producerTransport;
let producer;
let consumerTransport;
let consumer;

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });

  console.log("worker pid", worker.pid);

  worker.on("died", () => {
    console.log("worker died.");
    setTimeout(() => process.exit(1), 2000);
  });
};

// create worker
createWorker();

// media codes
const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];

// create webtrc transport
const createWebRtcTransport = async (callback) => {
  const webRtc__options = {
    listenIps: [
      {
        ip: "0.0.0.0",
        announcedIp: "192.168.220.186",
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  };

  try {
    const transport = await router.createWebRtcTransport(webRtc__options);

    transport.on("dtlsstatechange", (dtlsstatechange) => {
      if (dtlsstatechange === "closed") {
        transport.close();
      }
    });

    transport.on("close", (dtlsstatechange) => {
      console.log("transport closed.");
    });

    callback({
      id: transport.id,
      iceCandidates: transport.iceCandidates,
      iceParameters: transport.iceParameters,
      dtlsParameters: transport.dtlsParameters,
    });

    return transport;
  } catch (error) {
    callback({
      error: error,
    });
  }
};

io.on("connection", async (socket) => {
  console.log("socket connected", socket.id);

  // get rtp capabilities
  socket.on("GET_RTP_CAPABILITIES", async (callback) => {
    if (!router) {
      router = await worker.createRouter({ mediaCodecs });
    }

    callback({ rtpCapabilities: router.rtpCapabilities });
  });

  // create webrtc transport
  socket.on("CREATE_WEBRTC_TRANSPORT", async ({ sender }, callback) => {
    if (sender) {
      producerTransport = await createWebRtcTransport(callback);
    } else {
      consumerTransport = await createWebRtcTransport(callback);
    }
  });

  // transport connect - produce
  socket.on("TRANSPORT_CONNECT", async (dtlsParameters) => {
    try {
      await producerTransport.connect({ dtlsParameters });
    } catch (error) {
      console.log("Error/TRANSPORT_CONNECT", error);
    }
  });

  // transport produce
  socket.on("TRANSPORT_PRODUCE", async ({ kind, rtpParameters }, callback) => {
    try {
      producer = await producerTransport.produce({ kind, rtpParameters });
      callback(producer.id);
    } catch (error) {
      console.log("Error/TRANSPORT_PRODUCE", error);
    }
  });

  // transport connect - consume
  socket.on("CONNECT_CONSUMER_TRANSPORT", async (dtlsParameters) => {
    try {
      await consumerTransport.connect({ dtlsParameters });
    } catch (error) {
      console.log("Error/TRANSPORT_RECV_CONNECT", error);
    }
  });

  // consume
  socket.on("TRANSPORT_CONSUME", async ({ rtpCapabilities }, callback) => {
    try {
      const canConsume = router.canConsume({
        producerId: producer.id,
        rtpCapabilities,
      });

      if (canConsume) {
        consumer = await consumerTransport.consume({
          producerId: producer.id,
          rtpCapabilities,
          paused: true,
        });

        callback({
          consumerId: consumer.id,
          producerId: producer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        });
      }
    } catch (error) {
      console.log("Error/consumer transport:");
    }
  });

  // resume consumer
  socket.on("RESUME", async () => {
    try {
      await consumer.resume();
    } catch (error) {
      console.log("Error/consumer resume:");
    }
  });
});

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

const ip = "192.168.246.187";

const allowedHeaders = [
  "https://localhost:3000",
  "https://localhost:3300",
  `https://${ip}:3000`,
  `https://${ip}:3300`,
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

server.listen(3300, () => {
  console.log("Server running on port 3300");
});

// mediasoup variables
let worker;

// n:n
let rooms = {};
/* 
  {
    [roomId] : {
      router: Router,
      peers: [socket],
      producerTransport: [],
      consumerTransport: []
      producerIds: [],
      consumers: []
    }
  }
*/
let peers = {};
/*
{
  [socketId] : {
    roomId: "123",
    user: {}
  }
}
*/

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 30000,
    rtcMaxPort: 40000,
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
const _createWebRtcTransport = async (router, callback) => {
  const webRtc__options = {
    listenIps: [
      {
        ip: "0.0.0.0",
        announcedIp: ip,
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

    return { error };
  }
};

// socket
io.on("connection", async (socket) => {
  console.log("socket connected", socket.id);

  // create or join room
  socket.on("JOIN_ROOM", async ({ roomId, user }, callback) => {
    let router;

    if (!rooms[roomId]) {
      router = await worker.createRouter({ mediaCodecs });

      // create room with id
      rooms[roomId] = {};
      rooms[roomId].router = router;
      rooms[roomId].peers = [socket];
      rooms[roomId].producerTransports = [];
      rooms[roomId].consumerTransports = [];
      rooms[roomId].peers = [socket];
      rooms[roomId].producerIds = [];
      rooms[roomId].consumers = [];

      // create peer with id
      peers[socket.id] = {};
      peers[socket.id].roomId = roomId;
      peers[socket.id].user = {...user};

    } else {
      // get router and push new socket
      router = rooms[roomId].router;
      rooms[roomId].peers.push(socket);

      // add roomId to the new peer
      peers[socket.id] = {};
      peers[socket.id].roomId = roomId;

    }

    console.log("rooms", rooms);

    createNewMemberSocket(socket, roomId);
    callback({ rtpCapabilities: router.rtpCapabilities });
  });

  // create webrtc transport
  socket.on("WEBRTC_TRANSPORT", async ({ consumer }, callback) => {
    const room = rooms[peers[socket.id].roomId];

    const transport = await _createWebRtcTransport(room.router, callback);

    if (transport.error) {
      console.log("transport/error", transport.error);
      return;
    }

    const _transport = {
      transport,
      sid: socket.id,
      id: transport.id,
    };

    if (consumer) {
      room.consumerTransports.push(_transport);
    } else {
      room.producerTransports.push(_transport);
    }
  });

  // connect producer
  socket.on("CONNECT_PRODUCER", async (dtlsParameters) => {
    try {
      const transport = getTransport("producer", socket, { sid: socket.id });
      transport.connect({ dtlsParameters });
    } catch (error) {
      console.log("Error/CONNECT_PRODUCER:", error);
    }
  });

  // start produce
  socket.on("START_PRODUCE", async ({ kind, rtpParameters }, callback) => {
    try {
      const producer = await getTransport("producer", socket, {
        sid: socket.id,
      }).produce({
        kind,
        rtpParameters,
      });
      callback(producer.id);
      addProducerId(socket.id, producer.id);
    } catch (error) {
      console.log("Error/START_PRODUCE:", error);
    }
  });

  // connect - consumer transport
  socket.on("CONNECT_CONSUMER", async ({ dtlsParameters, consumerId }) => {
    try {
      const transport = getTransport("consumer", socket, { id: consumerId });
      await transport.connect({ dtlsParameters });
    } catch (error) {
      console.log("Error/CONNECT_CONSUMER:", error);
    }
  });

  // start consume
  socket.on(
    "START_CONSUME",
    async ({ rtpCapabilities, remoteProducerId, consumerId }, callback) => {
      const room = rooms[peers[socket.id].roomId];
      const consumerTransport = getTransport("consumer", socket, {
        id: consumerId,
      });
      let consumer;

      try {
        const canConsume = room.router.canConsume({
          producerId: remoteProducerId,
          rtpCapabilities,
        });

        if (canConsume) {
          consumer = await consumerTransport.consume({
            producerId: remoteProducerId,
            rtpCapabilities,
            paused: true,
          });

          consumer.on("transportclose", () => {
            console.log("transport closed");
          });

          consumer.on("producerclose", () => {
            console.log("producer closed");
            consumerTransport.close([]);
            consumer.close();
            room.peers.forEach((_socket) => {
              _socket.emit("MEMBER_LEFT", { remoteProducerId });
            });

            removeConsumer(socket.id, consumer.id);
            removeConsumerTransport(socket.id, consumerTransport.id);

          });

          callback({
            consumerId: consumer.id,
            producerId: remoteProducerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
          });

          // add it room
          room.consumers.push({
            id: consumer.id,
            sid: socket.id,
            consumer,
          });

        }
      } catch (error) {
        console.log("Error/START_CONSUME:", error);
      }
    }
  );

  // resume consumer
  socket.on("RESUME", async ({ consumerId }) => {
    try {
      const consumer = getConsumer(socket.id, consumerId);
      await consumer.resume();
    } catch (error) {
      console.log("Error/RESUME:", error);
    }
  });

  // clean up socket
  socket.on("disconnect", () => {
    if (peers[socket.id]) {
      removeProducerTransport(socket.id);
      removePeer(socket.id);
      removeConsumers(socket.id);
      removeProducerId(socket.id);
      delete peers[socket.id];
      console.log("disconnect/clean-up", rooms);
    }
  });
});

// socket utilities
/* create socket for room new joiner signal */
const createNewMemberSocket = (socket, roomId) => {
  socket.on(`SIGNAL/NEW_MEMBER/${roomId}`, (id) => {
    rooms[roomId].peers.forEach((_socket) => {
      _socket.emit(`NEW_MEMBER/${roomId}`, rooms[roomId].producerIds);
    });
  });
};

// utilities
/* get transport from room */
const getTransport = (type, socket, option) => {
  const room = rooms[peers[socket.id].roomId];
  let object;

  if (type === "consumer" && option.sid) {
    object = room.consumerTransports.find(({ sid }) => sid === option.sid);
  }

  if (type === "consumer" && option.id) {
    object = room.consumerTransports.find(({ id }) => id === option.id);
  }

  if (type === "producer" && option.sid) {
    object = room.producerTransports.find(({ sid }) => sid === option.sid);
  }

  return object.transport;
};

/* remove producer transport from room */
const removeProducerTransport = (socketId) => {
  const room = rooms[peers[socketId].roomId];
  room.producerTransports = room.producerTransports.filter(
    ({ sid }) => sid !== socketId
  );
};

/* remove consumer and consumer transport*/
const removeConsumers = (socketId) => {
  const room = rooms[peers[socketId].roomId];
  room.consumerTransports = room.consumerTransports.filter(
    ({ sid }) => sid !== socketId
  );
  room.consumers = room.consumers.filter(({ sid }) => sid !== socketId);
};

/* remove peer socket from room */
const removePeer = (socketId) => {
  const room = rooms[peers[socketId].roomId];
  room.peers = room.peers.filter((socket) => socket.id !== socketId);
};

/* add producer id to room */
const addProducerId = (socketId, producerId) => {
  const room = rooms[peers[socketId].roomId];
  room.producerIds.push({
    sid: socketId,
    id: producerId,
  });
};

/* remove producer id to room */
const removeProducerId = (socketId) => {
  const room = rooms[peers[socketId].roomId];
  room.producerIds = room.producerIds.filter(({ sid }) => sid !== socketId);
};

// get consumer
const getConsumer = (socketId, consumerId) => {
  const room = rooms[peers[socketId].roomId];
  return room.consumers.find(({ id }) => id === consumerId).consumer;
};

// remove consumer
const removeConsumer = (socketId, consumerId) => {
  const room = rooms[peers[socketId].roomId];
  room.consumers = room.consumers.filter(({ id }) => id != consumerId);
};

/* remove consumer transport*/
const removeConsumerTransport = (socketId, _id) => {
  const room = rooms[peers[socketId].roomId];
  room.consumerTransports = room.consumerTransports.filter(
    ({ id }) => id !== _id
  );
};

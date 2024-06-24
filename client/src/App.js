import { useEffect, useRef } from "react";
import styled from "styled-components";
import { Device } from "mediasoup-client";
import io from "socket.io-client";

import "./App.css";

const socket = io("http://localhost:3300/");
const device = new Device();

let params = {
  // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
  encodings: [
    {
      rid: "r0",
      maxBitrate: 100000,
      scalabilityMode: "S1T3",
    },
    {
      rid: "r1",
      maxBitrate: 300000,
      scalabilityMode: "S1T3",
    },
    {
      rid: "r2",
      maxBitrate: 900000,
      scalabilityMode: "S1T3",
    },
  ],
  // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
  codecOptions: {
    videoGoogleStartBitrate: 1000,
  },
};

let rtpCapabilities;
let producerTransport;
let consumerTransport;
let producer;
let consumer;

function App() {
  const videoClientRef = useRef(null);
  const videoRemoteRef = useRef(null);

  /** node:00
   * get user media
   **/

  const getUserMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: 800,
          height: 450,
        },
        // audio: true,
      });

      videoClientRef.current.srcObject = stream;

      params = {
        track: stream.getTracks()[0],
        ...params,
      };
    } catch (error) {
      console.log("Error/get media streams:", error);
    }
  };

  /**
   * node:02
   * create device
   **/
  const createDevice = async () => {
    try {
      await device.load({
        routerRtpCapabilities: rtpCapabilities,
      });
      console.log("02: create device.");
      createSendTransport();
    } catch (error) {
      console.log("Error/create device:", error);
    }
  };

  /**
   * node:03
   * create send transport
   */
  const createSendTransport = async () => {
    console.log("03: create send transport.");

    // get transport parameters from server
    socket.emit("CREATE_WEBRTC_TRANSPORT", { sender: true }, async (params) => {
      if (params.error) {
        console.log("Error/create send transport:", params.error);
        return;
      }

      producerTransport = device.createSendTransport(params);

      producerTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errback) => {
          try {
            console.log("05: producer transport on connect:", dtlsParameters);
            // connect send transport on server
            await socket.emit("TRANSPORT_CONNECT", dtlsParameters);

            // must be invoked to tell server dtls parameter transferred
            callback();
          } catch (error) {
            console.log("Error/producer transport on connect:", error);
            errback(error);
          }
        }
      );

      producerTransport.on("produce", async (params, callback, errback) => {
        console.log("06: producer transport on produce:", params);

        try {
          const { kind, rtpParameters } = params;
          await socket.emit(
            "TRANSPORT_PRODUCE",
            { kind, rtpParameters },
            (id) => {
              callback({ id });
              // [for now creating immediate consumer]
              createReceiverTransport();
            }
          );
        } catch (error) {
          console.log("Error/producer transport on produce:", error);
          errback(error);
        }
      });

      // connect send transport
      connectSendTransport();
    });
  };

  /**
   * node:04
   * connect send transport
   * */
  const connectSendTransport = async () => {
    console.log("04: connect send transport.", params);

    producer = await producerTransport.produce(params);

    producer.on("trackended", () => {
      console.log("video ended.");
    });

    producer.on("transportclose", () => {
      console.log("transport closed.");
    });
  };

  /**
   * node: 07
   * create receiver transport
   */
  const createReceiverTransport = () => {
    console.log("07: create receiver transport.");
    socket.emit(
      "CREATE_WEBRTC_TRANSPORT",
      { sender: false },
      async (params) => {
        consumerTransport = device.createRecvTransport(params);

        // consumer transport on connect
        consumerTransport.on(
          "connect",
          async ({ dtlsParameters }, callback, errback) => {
            try {
              console.log("on consumer connect.", dtlsParameters);
              await socket.emit("CONNECT_CONSUMER_TRANSPORT", dtlsParameters);
              callback();
            } catch (error) {
              errback(errback);
            }
          }
        );

        connectReceiverTransport();
      }
    );
  };

  /**
   * node:08
   * connect receiver transport
   */
  const connectReceiverTransport = async () => {
    console.log("08: connect receiver transport.");
    socket.emit(
      "TRANSPORT_CONSUME",
      { rtpCapabilities: device.rtpCapabilities },
      async (params) => {
        console.log("on consume.", params);

        consumer = await consumerTransport.consume({
          producerId: params.producerId,
          id: params.consumerId,
          rtpParameters: params.rtpParameters,
          kind: params.kind,
        });

        const { track } = consumer;

        console.log("09: media tracks. ", track);

        videoRemoteRef.current.srcObject = new MediaStream([track]);
        socket.emit("RESUME");
      }
    );
  };

  /**
   * node: start
   * mediasoup
   **/
  useEffect(() => {
    (async () => {
      console.log("00: get user media.");
      await getUserMedia();

      /**
       * node:01
       * get RTP capabilities from server and create device.
       **/
      socket.emit("GET_RTP_CAPABILITIES", (params) => {
        console.log("01: get rtp capabilities.", params.rtpCapabilities);
        rtpCapabilities = params.rtpCapabilities;
        createDevice();
      });
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Container>
      <video ref={videoClientRef} autoPlay></video>
      <video ref={videoRemoteRef} autoPlay></video>
    </Container>
  );
}

const Container = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 1.2rem;
  video {
    width: 100%;
    aspect-ratio: 16/9;
  }
`;

export default App;

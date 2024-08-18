import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { useNavigate, useParams } from "react-router";

import { Device } from "mediasoup-client";
import io from "socket.io-client";

import { Button, Input } from "antd";

import "./App.css";

import { customAlphabet } from "nanoid";
const nanoid = customAlphabet("abcdefghijlmnopqrstvwxyz");

const socket = io("https://192.168.246.187:3300");
const device = new Device();

let videoParams = {
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

let audioParams = {}

let producerTransport;
let consumers = [];
let videoProducer;
let producerIds = [];
let remoteProducerIds = []
let audioProducer;

function App() {
  const videoClientRef = useRef(null);
  const containerRef = useRef(null);

  const navigate = useNavigate();
  const { roomId } = useParams();
  const [hasJoined, setHasJoined] = useState(false);
  const [userName, setUserName] = useState("Unknown")

  /**
   * get user media
   **/
  const getUserMedia = async () => {
    let screenStream;
    let videoStream;
    let audioStream;

    try{
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true
      });

      screenStream = stream.getVideoTracks()[0]
    }catch(error){
      console.log(error)
      alert(error);
    }

    try{
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      audioStream = stream.getAudioTracks()[0]
      videoStream = stream.getVideoTracks()[0]
    }catch(error){
      console.log(error)
      alert(error);
    }

    try {
      console.log("00: get media streams", screenStream, videoStream, audioStream);
      videoStream = screenStream ? screenStream : videoStream
      videoParams = {
        track: videoStream,
        ...videoParams,
      };

      audioParams = {
        track: audioStream
      }

      videoClientRef.current.srcObject = new MediaStream([videoStream]);

    } catch (error) {
      console.log("Error/get media streams:", error);
      alert(error);
    }
  };

  /**
   * create producer transport and start produce
   */
  const createProducerTransport = async () => {
    // create send transport
    socket.emit("WEBRTC_TRANSPORT", { consumer: false }, async (params) => {
      if (params.error) {
        console.log("Error/create producer transport:", params);
        return;
      }

      producerTransport = device.createSendTransport(params);

      console.log("03: create send transport.", producerTransport);

      producerTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errback) => {
          try {
            console.log("05: producer transport on connect:", dtlsParameters);
            // connect send transport on server
            await socket.emit("CONNECT_PRODUCER", dtlsParameters);

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
          await socket.emit("START_PRODUCE", { kind, rtpParameters }, (id) => {
            
            callback({ id });

            socket.emit(`SIGNAL/NEW_MEMBER/${roomId}`, id);
            producerIds.push(id);
          });
        } catch (error) {
          console.log("Error/producer transport on produce:", error);
          errback(error);
        }
      });

      // connect producer transport and start produce
      console.log("04: connect producer transport.", videoParams);

      audioProducer = await producerTransport.produce(audioParams);
      videoProducer = await producerTransport.produce(videoParams);

      videoProducer.on("trackended", () => {
        console.log("video ended.");
      });

      videoProducer.on("transportclose", () => {
        console.log("transport closed.");
      });


      audioProducer.on("trackended", () => {
        console.log("audio ended.");
      });

      audioProducer.on("transportclose", () => {
        console.log("transport closed.");
      });

    });
  };

  /**
   * create consumer transport and start consume
   */
  const createConsumerTransport = (remoteProducerId) => {
    socket.emit("WEBRTC_TRANSPORT", { consumer: true }, async (params) => {
      if (params.error) {
        console.log("Error/create consumer transport:", params);
        return;
      }

      let consumerTransport = device.createRecvTransport(params);
      console.log("03: create receiver transport.", consumerTransport);

      // consumer transport on connect
      consumerTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errback) => {
          try {
            console.log("05: on consumer connect.", dtlsParameters);
            await socket.emit("CONNECT_CONSUMER", {
              consumerId: params.id,
              dtlsParameters,
            });
            callback();
          } catch (error) {
            errback(errback);
          }
        }
      );

      // start consume
      socket.emit(
        "START_CONSUME",
        {
          rtpCapabilities: device.rtpCapabilities,
          remoteProducerId: remoteProducerId,
          consumerId: params.id,
        },
        async (params) => {
          let consumer = await consumerTransport.consume({
            producerId: params.producerId,
            id: params.consumerId,
            rtpParameters: params.rtpParameters,
            kind: params.kind,
          });

          const { track } = consumer;

          // add consumer and transport
          consumers.push({
            remoteProducerId: remoteProducerId,
            consumerId: params.consumerId,
            consumer,
            transport: consumerTransport,
          });

          if(params.kind === "video"){
            const _video = document.querySelector(`video#${btoa(params.consumerId)}`);
            if (!_video) {
              const video = document.createElement("video");
              video.autoplay = true;
              video.id = btoa(params.consumerId);
              video.srcObject = new MediaStream([track]);
              containerRef.current.appendChild(video);
            }

          }

          if(params.kind === "audio"){
            const _audio = document.querySelector(`audio#${btoa(params.consumerId)}`);
            if (!_audio) {
              const audio = document.createElement("audio");
              audio.autoplay = true;
              audio.id = btoa(params.consumerId);
              audio.srcObject = new MediaStream([track]);
              containerRef.current.appendChild(audio);
            }
          }
          
          // resume stream
          socket.emit("RESUME", { consumerId: params.consumerId });
        }
      );
    });
  };

  /**
   * create room and join
  */
  const createRoomId = async () => {
    const start = nanoid(3);
    const middle = nanoid(4);
    const end = nanoid(3);
    const _roomId = `${start}-${middle}-${end}`;

    // if room does not exist create and navigate to new room id
    if (!roomId) {
      navigate(`/room/${_roomId}`);
      return;
    }

    if (hasJoined) return;

    // attach new member trigger socket
    socket.on(`NEW_MEMBER/${roomId}`, (_producerIds) => {
      console.log("new-members", _producerIds);
      _producerIds.forEach(({ id }) => {
        if (!producerIds.includes(id) && !remoteProducerIds.includes(id)) {
          remoteProducerIds.push(id);
          createConsumerTransport(id);
        }
      });
    });

    // attach member left socket
    socket.on("MEMBER_LEFT", ({ remoteProducerId }) => {
      const consumerData = consumers.find(({ remoteProducerId: id }) => id === remoteProducerId);
      
      if (consumerData) {
        const { consumer, transport } = consumerData;
        consumer.close();
        transport.close();

        // clean up
        consumers = consumers.filter(({ id }) => id !== remoteProducerId);
        remoteProducerIds = remoteProducerIds.filter((id) => id !== remoteProducerId);

        // remove elements
        const video = document.querySelector(`video#${btoa(consumer.id)}`);
        const audio = document.querySelector(`audio#${btoa(consumer.id)}`);
        if (video) {
          containerRef.current.removeChild(video);
        }
        if (audio) {
          containerRef.current.removeChild(audio);
        }

      }
    });

    try {
      await getUserMedia();
      socket.emit("JOIN_ROOM", { roomId, user : { name: userName } }, async (params) => {
        let rtpCapabilities = params.rtpCapabilities;
        await device.load({
          routerRtpCapabilities: rtpCapabilities,
        });

        createProducerTransport();
        setHasJoined(true);

        console.log("rtp capabilities", rtpCapabilities);
      });
    } catch (error) {
      console.log("error/createRoom");
    }
  };

  return (
    <Container>
      <section className="videos-container" ref={containerRef}>
        <video ref={videoClientRef} autoPlay></video>
      </section>

      <hr />

      <section className="execute-buttons-container">
        <section>
          <Input placeholder="Enter your name"  onChange={(e)=>{
            setUserName(e.target.value )
          }}/>
        </section>
        <section>
          <Button
            type="default"
            onClick={createRoomId}
            disabled={hasJoined}
            size="medium"
          >
            {roomId ? (hasJoined ? "Joined" : "Join Room") : "Create Room"}
          </Button>
        </section>
      </section>
      <hr />
    </Container>
  );
}

const Container = styled.div`
  padding: 1rem;

  .videos-container {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.2rem;
    video {
      width: 100%;
      aspect-ratio: 16/9;
      border-radius: 8px;
    }
  }

  @media screen and (max-width: 560px) {
    grid-template-columns: repeat(1, minmax(0, 1fr));
  }

  .btn-container {
    margin-top: 1rem;
    text-align: center;
  }

  .execute-buttons-container {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  .execute-buttons-container section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  hr {
    border: 0;
    border-bottom: 1px dashed #d5d5d5;
    margin: 1rem;
  }
`;

export default App;

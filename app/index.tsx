import React, { useRef, useState } from "react";
import {
  View,
  StyleSheet,
  Text,
  Pressable,
  ImageBackground,
} from "react-native";
import { GLView } from "expo-gl";
import { Asset } from "expo-asset";
import {
  Scene,
  PerspectiveCamera,
  HemisphereLight,
  AnimationMixer,
  Clock,
  LoopOnce,
  LoopRepeat,
  AnimationAction,
  AnimationClip,
} from "three";
import { Renderer } from "expo-three";
import * as ExpoTHREE from "expo-three";
import { GLTFLoader, GLTF } from "three/examples/jsm/loaders/GLTFLoader";

import Courtyard from "../assets/images/courtyard.png";
import {
  GestureHandlerRootView,
  PanGestureHandler,
  PanGestureHandlerGestureEvent,
  TapGestureHandler,
  State,
} from "react-native-gesture-handler";

/* ------------------------------------------------------------------ */
/*  model & texture files                                              */
const dogModel = {
  file: require("../models/dog/source/dog.glb"),
  scale: { x: 1, y: 1, z: 1 },
  position: { x: 0, y: -0.8, z: 3.35 },
};

const colorTexFile = require("../models/dog/textures/dog_color.png_1.png");
const normalTexFile = require("../models/dog/textures/dog_normal.png_0.png");
/* ------------------------------------------------------------------ */

async function loadGltfAsync(moduleId: number): Promise<GLTF> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  return new Promise((res, rej) =>
    new GLTFLoader().load(asset.localUri ?? asset.uri, res, undefined, rej)
  );
}

/* ------------------------------------------------------------------ */

export default function RNThree() {
  /* Patch to remove spam of console logs */
  const log = console.log;
  console.log = (...a) => {
    if (
      typeof a[0] === "string" &&
      a[0].includes("gl.pixelStorei() doesn't support this parameter yet")
    )
      return;
    log(...a);
  };

  /* refs ------------------------------------------------------------ */
  const mixerRef = useRef<AnimationMixer | null>(null);
  const idleRef = useRef<AnimationAction | null>(null);
  const jumpRef = useRef<AnimationAction | null>(null);
  const attackRef = useRef<AnimationAction | null>(null);
  const runRef = useRef<AnimationAction | null>(null);
  const walkRef = useRef<AnimationAction | null>(null);
  const creepRef = useRef<AnimationAction | null>(null);
  const modelRef = useRef<ExpoTHREE.THREE.Object3D | null>(null);
  const currentActionRef = useRef<AnimationAction | null>(null);
  const [ready, setReady] = useState(false);
  const startRotY = useRef<number>(0);

  /* ------------------ cross-fade helper --------------------- */
  const FADE = 0.25; // seconds – tweakable for desired transition results
  const fadeTo = (
    action: AnimationAction | null,
    loop: typeof LoopOnce | typeof LoopRepeat = LoopRepeat
  ) => {
    if (!mixerRef.current || !action || currentActionRef.current === action) {
      return;
    }

    action.reset();
    action.setLoop(loop, loop === LoopOnce ? 1 : Infinity);
    action.clampWhenFinished = true;
    action.enabled = true;

    if (currentActionRef.current) {
      currentActionRef.current.crossFadeTo(action, FADE, false);
    }

    action.fadeIn(FADE).play();
    currentActionRef.current = action;
  };

  /* ------------------------------------------------ helpers -------- */
  const playOnceThenIdle = (action: AnimationAction | null) => {
    const idle = idleRef.current;
    if (!idle) return;

    fadeTo(action, LoopOnce);

    const mixer = mixerRef.current;
    const onFinish = (e: any) => {
      if (e.action === action) {
        mixer?.removeEventListener("finished", onFinish);
        fadeTo(idle); // smooth back to idle
      }
    };
    mixer?.addEventListener("finished", onFinish);
  };

  const playContinuous = (action: AnimationAction | null) =>
    fadeTo(action, LoopRepeat);

  /* ----------- pan to rotate -------------------------------------- */
  const onPan = ({ nativeEvent }: PanGestureHandlerGestureEvent) => {
    if (!modelRef.current) return;

    if (nativeEvent.state === State.BEGAN) {
      startRotY.current = modelRef.current.rotation.y;
    } else if (nativeEvent.state === State.ACTIVE) {
      const delta = nativeEvent.translationX * 0.012;
      modelRef.current.rotation.y = startRotY.current + delta;
    }
  };

  /* ---------------------------------------------------------------- */
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ImageBackground source={Courtyard} resizeMode="cover" style={styles.bg}>
        <View style={styles.container}>
          <PanGestureHandler
            onHandlerStateChange={onPan}
            onGestureEvent={onPan}
          >
            <TapGestureHandler
              maxDurationMs={250}
              onActivated={() => playOnceThenIdle(jumpRef.current)}
            >
              <GLView
                style={{ height: 500, width: "100%" }}
                onContextCreate={async (gl) => {
                  /* boiler-plate ----------------------------------- */
                  const { drawingBufferWidth: w, drawingBufferHeight: h } = gl;
                  const renderer = new Renderer({ gl });
                  renderer.setSize(w, h);

                  const scene = new Scene();
                  const camera = new PerspectiveCamera(75, w / h, 0.1, 1000);
                  camera.position.z = 5;
                  scene.add(new HemisphereLight(0xffffff, 0x222222, 3));

                  /* model ----------------------------------------- */
                  const gltf = await loadGltfAsync(dogModel.file);
                  const model = gltf.scene;
                  model.scale.set(
                    dogModel.scale.x,
                    dogModel.scale.y,
                    dogModel.scale.z
                  );
                  model.position.set(
                    dogModel.position.x,
                    dogModel.position.y,
                    dogModel.position.z
                  );
                  model.rotation.y = Math.PI;
                  scene.add(model);
                  modelRef.current = model;

                  /* textures -------------------------------------- */
                  const [map, normal] = await Promise.all([
                    ExpoTHREE.loadAsync(colorTexFile),
                    ExpoTHREE.loadAsync(normalTexFile),
                  ]);
                  map.flipY = normal.flipY = true;

                  model.traverse((o: any) => {
                    if (o.isMesh && o.material) {
                      o.material.map = map;
                      o.material.normalMap = normal;
                      o.material.needsUpdate = true;
                    }
                  });

                  /* animations ------------------------------------ */
                  const mixer = new AnimationMixer(model);
                  mixerRef.current = mixer;

                  const find = (n: string) =>
                    gltf.animations.find((c) => c.name.toLowerCase() === n);

                  const reg = (
                    ref: React.MutableRefObject<AnimationAction | null>,
                    clip?: AnimationClip,
                    play = false
                  ) => {
                    ref.current = clip ? mixer.clipAction(clip) : null;
                    if (play && ref.current) ref.current.play();
                  };

                  reg(
                    idleRef,
                    find("idle") ?? find("iddle") ?? gltf.animations[0],
                    true
                  );
                  reg(jumpRef, find("jump"));
                  reg(attackRef, find("attack1"));
                  reg(runRef, find("run"));
                  reg(walkRef, find("walk"));
                  reg(creepRef, find("walksent"));

                  currentActionRef.current = idleRef.current; // ✨ new

                  /* render loop ----------------------------------- */
                  const clock = new Clock();
                  (function loop() {
                    requestAnimationFrame(loop);
                    mixer.update(clock.getDelta());
                    renderer.render(scene, camera);
                    gl.endFrameEXP();
                  })();

                  setReady(true);
                }}
              />
            </TapGestureHandler>
          </PanGestureHandler>

          {/* controls ------------------------------------------- */}
          <View style={styles.wrapper}>
            {[
              { t: "Attack!", cb: () => playOnceThenIdle(attackRef.current) },
              { t: "Walk", cb: () => playContinuous(walkRef.current) },
              { t: "Run", cb: () => playContinuous(runRef.current) },
              { t: "Creep", cb: () => playContinuous(creepRef.current) },
            ].map(({ t, cb }) => (
              <Pressable
                key={t}
                style={({ pressed }) => [
                  styles.btn,
                  pressed && styles.btnPressed,
                  !ready && { opacity: 0.5 },
                ]}
                disabled={!ready}
                onPress={cb}
              >
                <Text style={styles.btnLabel}>{t}</Text>
              </Pressable>
            ))}
          </View>

          {!ready && (
            <View style={styles.loading}>
              <Text>Wouf wouf…</Text>
            </View>
          )}
        </View>
      </ImageBackground>
    </GestureHandlerRootView>
  );
}
/* ----------------------- styles ------------------------------- */
const styles = StyleSheet.create({
  bg: { height: 950 },
  container: {
    flex: 1,
    paddingTop: 50,
  },

  wrapper: {
    marginTop: 8,
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
  },

  btn: {
    backgroundColor: "rgba(172, 187, 128, 0.58)",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    justifyContent: "center",
    alignSelf: "center",
    alignContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(172, 187, 128)",
    width: 130,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  btnPressed: { opacity: 0.75 },
  btnLabel: { color: "#fff", fontWeight: "600", fontSize: 16 },

  loading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
});

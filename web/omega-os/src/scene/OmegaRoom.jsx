import React, { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { RoundedBox, Text } from '@react-three/drei'
import { DoubleSide } from 'three'

const damp = (value, target, lambda, delta) => value + (target - value) * (1 - Math.exp(-lambda * delta))

function RoomShell({ running }) {
  const pulse = running ? 0.75 : 0.35
  return (
    <group>
      <color attach="background" args={['#020605']} />
      <fog attach="fog" args={['#020605', 7, 26]} />
      <mesh position={[0, -1.78, -2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[30, 28]} />
        <meshStandardMaterial color="#07110e" roughness={0.86} metalness={0.06} />
      </mesh>
      <mesh position={[0, 5.8, -2]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[30, 28]} />
        <meshStandardMaterial color="#06100d" roughness={0.92} metalness={0.04} />
      </mesh>
      <mesh position={[0, 1.8, -11.8]}>
        <planeGeometry args={[30, 8]} />
        <meshStandardMaterial color="#06100d" roughness={0.9} metalness={0.04} />
      </mesh>
      <mesh position={[-14.2, 1.8, -2]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[28, 8]} />
        <meshStandardMaterial color="#050d0b" roughness={0.92} metalness={0.04} />
      </mesh>
      <mesh position={[14.2, 1.8, -2]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[28, 8]} />
        <meshStandardMaterial color="#08120f" roughness={0.92} metalness={0.04} />
      </mesh>
      {[-8, -4, 0, 4, 8].map((x, index) => (
        <mesh key={x} position={[x, 1.75, -11.72]}>
          <planeGeometry args={[0.018, 7.4]} />
          <meshBasicMaterial color={index === 2 ? '#64f0ce' : '#d2a74a'} transparent opacity={0.11 + pulse * 0.08} />
        </mesh>
      ))}
      {[-9, -5.5, -2, 2, 5.5, 9].map(x => (
        <mesh key={x} position={[x, -1.765, -3.5]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.014, 15]} />
          <meshBasicMaterial color="#d2a74a" transparent opacity={0.08 + pulse * 0.04} />
        </mesh>
      ))}
    </group>
  )
}

function OmegaCore({ running }) {
  const ref = useRef()
  useFrame(({ clock }, delta) => {
    if (!ref.current) return
    const target = running ? 1.1 : 0.92
    ref.current.scale.setScalar(damp(ref.current.scale.x, target + Math.sin(clock.elapsedTime * 1.4) * 0.035, 5, delta))
  })
  return (
    <group ref={ref} position={[0, 1.55, -9.1]}>
      <mesh castShadow>
        <sphereGeometry args={[0.48, 64, 64]} />
        <meshStandardMaterial
          color="#f8fff8"
          emissive="#44f5c6"
          emissiveIntensity={running ? 0.9 : 0.35}
          roughness={0.32}
          metalness={0.08}
        />
      </mesh>
      <pointLight color="#54ffd1" intensity={running ? 4.8 : 1.8} distance={10} />
    </group>
  )
}

function ConsoleText({ activeSurface, inputText, inputKind, inputFocus, progress }) {
  const isLogin = activeSurface === 'login'
  const heading = isLogin ? 'OMEGA ACCESS' : 'SPEAK WITH OMEGA'
  const focus = inputFocus === 'passcode' ? 'PASSCODE' : inputFocus === 'name' ? 'NAME' : 'MESSAGE'
  const text = inputText?.trim() || (isLogin ? focus : 'press enter, then speak')
  return (
    <group position={[0, 0.54 + progress * 0.035, 0.82]}>
      <Text
        position={[-1.86, 0.16, 0]}
        fontSize={0.095}
        letterSpacing={0.06}
        color="#9fffe0"
        anchorX="left"
        anchorY="middle"
        maxWidth={3.7}
      >
        {heading}
        <meshBasicMaterial attach="material" color="#9fffe0" side={DoubleSide} />
      </Text>
      <Text
        position={[-1.86, -0.16, 0]}
        fontSize={inputKind === 'chat' ? 0.17 : 0.145}
        letterSpacing={0.018}
        color={inputText ? '#f4fff8' : '#5f8c7d'}
        anchorX="left"
        anchorY="middle"
        maxWidth={3.45}
      >
        {text.slice(0, 84)}
        <meshBasicMaterial attach="material" color={inputText ? '#f4fff8' : '#5f8c7d'} side={DoubleSide} />
      </Text>
      <Text
        position={[1.66, -0.16, 0]}
        fontSize={0.13}
        letterSpacing={0.02}
        color="#b88f37"
        anchorX="center"
        anchorY="middle"
      >
        SEND
        <meshBasicMaterial attach="material" color="#d9aa43" side={DoubleSide} />
      </Text>
    </group>
  )
}

function FloorConsole({ activeSurface, inputText, inputKind, inputFocus }) {
  const group = useRef()
  const lid = useRef()
  const glow = useRef()
  const open = activeSurface !== 'idle'
  const progress = useRef(0)

  useFrame(({ clock }, delta) => {
    progress.current = damp(progress.current, open ? 1 : 0, 4.8, delta)
    const p = progress.current
    if (group.current) {
      group.current.position.y = damp(group.current.position.y, -1.49 + p * 0.18, 5, delta)
      group.current.rotation.x = damp(group.current.rotation.x, -0.16 + p * 0.07, 5, delta)
    }
    if (lid.current) {
      lid.current.position.y = damp(lid.current.position.y, 0.2 + p * 0.17, 6, delta)
      lid.current.rotation.x = damp(lid.current.rotation.x, -0.06 - p * 0.1, 6, delta)
    }
    if (glow.current) {
      glow.current.material.opacity = 0.1 + p * 0.38 + Math.sin(clock.elapsedTime * 3.2) * 0.025
    }
  })

  return (
    <group ref={group} position={[0, -1.49, 1.48]} rotation={[-0.16, 0, 0]}>
      <mesh position={[0, -0.23, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[3.65, 96]} />
        <meshBasicMaterial color="#04100c" transparent opacity={0.72} depthWrite={false} />
      </mesh>
      <RoundedBox args={[5.25, 0.42, 1.62]} radius={0.24} smoothness={12} castShadow receiveShadow>
        <meshStandardMaterial color="#dcecdf" roughness={0.72} metalness={0.05} />
      </RoundedBox>
      <RoundedBox ref={lid} position={[0, 0.2, 0.02]} args={[4.76, 0.18, 1.2]} radius={0.18} smoothness={12} castShadow receiveShadow>
        <meshStandardMaterial color="#ecf8ef" roughness={0.62} metalness={0.03} />
      </RoundedBox>
      <RoundedBox position={[-0.18, 0.32, 0.2]} args={[3.62, 0.05, 0.45]} radius={0.1} smoothness={10} receiveShadow>
        <meshStandardMaterial color="#d4eadc" roughness={0.95} metalness={0} />
      </RoundedBox>
      <RoundedBox position={[1.78, 0.36, 0.2]} args={[0.68, 0.16, 0.45]} radius={0.11} smoothness={10} castShadow>
        <meshStandardMaterial color="#f8fff8" emissive="#123c31" emissiveIntensity={0.08} roughness={0.62} />
      </RoundedBox>
      <mesh ref={glow} position={[0, 0.405, 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[4.18, 0.92]} />
        <meshBasicMaterial color="#58ffd1" transparent opacity={0.1} depthWrite={false} />
      </mesh>
      <ConsoleText
        activeSurface={activeSurface}
        inputText={inputText}
        inputKind={inputKind}
        inputFocus={inputFocus}
        progress={progress.current}
      />
      <pointLight position={[0, 0.55, 0.25]} color="#7fffdc" intensity={open ? 1.9 : 0.35} distance={4.8} />
    </group>
  )
}

function OmegaScene({ running, activeSurface, inputText, inputKind, inputFocus }) {
  return (
    <>
      <ambientLight intensity={0.34} />
      <directionalLight position={[-4, 7, 5]} intensity={2.1} castShadow />
      <pointLight position={[0, 2.5, 3.2]} intensity={1.1} color="#fff7dd" distance={8} />
      <RoomShell running={running} />
      <OmegaCore running={running} />
      <FloorConsole
        activeSurface={activeSurface}
        inputText={inputText}
        inputKind={inputKind}
        inputFocus={inputFocus}
      />
    </>
  )
}

export function OmegaRoom({
  running = false,
  activeSurface = 'idle',
  inputText = '',
  inputKind = 'idle',
  inputFocus = 'none'
}) {
  const glSettings = useMemo(() => ({ antialias: true, alpha: false, powerPreference: 'high-performance' }), [])
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ position: [0, 1.18, 6.55], fov: 45, near: 0.1, far: 80 }}
      gl={glSettings}
    >
      <OmegaScene
        running={running}
        activeSurface={activeSurface}
        inputText={inputText}
        inputKind={inputKind}
        inputFocus={inputFocus}
      />
    </Canvas>
  )
}

export interface IConfig {
  sampleRate: number
  numChannels: number
}

const ctx: Worker = self as any

let recLength: number = 0
let recBuffers: Float32Array[][] = []
let sampleRate: number
let numChannels: number

ctx.onmessage = function(ev: MessageEvent) {
  const { command, payload } = ev.data

  switch (command) {
    case 'init':
      init(payload)
      break
    case 'record':
      record(payload.buffer)
      break
    case 'exportWAV':
      exportWAV(payload)
      break
    case 'getBuffer':
      getBuffer()
      break
    case 'clear':
      clear()
      break
  }
}

function init(config: IConfig) {
  sampleRate = config.sampleRate
  numChannels = config.numChannels
  initBuffers()
}

function record(inputBuffer: Float32Array[]) {
  for (let channel = 0; channel < numChannels; channel++) {
    recBuffers[channel].push(inputBuffer[channel])
  }
  recLength += inputBuffer[0].length
}

function exportWAV(payload: { type: string; rate?: number }) {
  let { type, rate = sampleRate } = payload
  let buffers = []
  for (let channel = 0; channel < numChannels; channel++) {
    buffers.push(mergeBuffers(recBuffers[channel], recLength))
  }
  let interleaved
  if (numChannels === 2) {
    interleaved = interleave(buffers[0], buffers[1])
  } else {
    interleaved = buffers[0]
  }
  let downsampledBuffer = downsampleBuffer(interleaved, rate)
  let dataview = encodeWAV(downsampledBuffer, rate)
  let audioBlob = new Blob([dataview], { type: type })

  ctx.postMessage({ command: 'exportWAV', payload: audioBlob })
}

function getBuffer() {
  let buffers = []
  for (let channel = 0; channel < numChannels; channel++) {
    buffers.push(mergeBuffers(recBuffers[channel], recLength))
  }
  ctx.postMessage({ command: 'getBuffer', data: buffers })
}

function clear() {
  recLength = 0
  recBuffers = []
  initBuffers()
}

function initBuffers() {
  for (let channel = 0; channel < numChannels; channel++) {
    recBuffers[channel] = []
  }
}

function mergeBuffers(recBuffers: Float32Array[], recLength: number) {
  let result = new Float32Array(recLength)
  let offset = 0
  for (let i = 0; i < recBuffers.length; i++) {
    result.set(recBuffers[i], offset)
    offset += recBuffers[i].length
  }
  return result
}

function interleave(inputL: Float32Array, inputR: Float32Array) {
  let length = inputL.length + inputR.length
  let result = new Float32Array(length)

  let index = 0
  let inputIndex = 0

  while (index < length) {
    result[index++] = inputL[inputIndex]
    result[index++] = inputR[inputIndex]
    inputIndex++
  }
  return result
}

function floatTo16BitPCM(output: DataView, offset: number, input: Float32Array) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, input[i]))
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

function downsampleBuffer(buffer: Float32Array, rate: number) {
  if (rate === sampleRate) {
    return buffer
  }
  if (rate > sampleRate) {
    throw new Error('downsampling rate show be smaller than original sample rate')
  }
  let sampleRateRatio = sampleRate / rate
  let newLength = Math.round(buffer.length / sampleRateRatio)
  let result = new Float32Array(newLength)
  let offsetResult = 0
  let offsetBuffer = 0
  while (offsetResult < result.length) {
    let nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio)
    let accum = 0
    let count = 0
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i]
      count++
    }
    result[offsetResult] = accum / count
    offsetResult++
    offsetBuffer = nextOffsetBuffer
  }
  return result
}

function encodeWAV(samples: Float32Array, rate: number) {
  let buffer = new ArrayBuffer(44 + samples.length * 2)
  let view = new DataView(buffer)

  /* RIFF identifier */
  writeString(view, 0, 'RIFF')
  /* RIFF chunk length */
  view.setUint32(4, 36 + samples.length * 2, true)
  /* RIFF type */
  writeString(view, 8, 'WAVE')
  /* format chunk identifier */
  writeString(view, 12, 'fmt ')
  /* format chunk length */
  view.setUint32(16, 16, true)
  /* sample format (raw) */
  view.setUint16(20, 1, true)
  /* channel count */
  view.setUint16(22, numChannels, true)
  /* sample rate */
  view.setUint32(24, rate, true)
  /* byte rate (sample rate * channels * bytes per sample) */
  view.setUint32(28, rate * numChannels * 2, true)
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, numChannels * 2, true)
  /* bits per sample */
  view.setUint16(34, 16, true)
  /* data chunk identifier */
  writeString(view, 36, 'data')
  /* data chunk length */
  view.setUint32(40, samples.length * 2, true)

  floatTo16BitPCM(view, 44, samples)

  return view
}

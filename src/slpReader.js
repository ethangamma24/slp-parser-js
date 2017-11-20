// @flow
import _ from 'lodash';
import fs from 'fs';

export const Commands = {
  MESSAGE_SIZES: 0x35,
  GAME_START: 0x36,
  FRAME_UPDATE: 0x38,
  GAME_END: 0x39
};

export type SlpFileType = {
  fileDescriptor: number,
  rawDataPosition: number,
  rawDataLength: number,
  messageSizes: { [command: number]: number }
}

export type PlayerType = {
  port: number,
  characterId: number,
  characterColor: number,
  type: number,
  teamId: number
};

export type GameStartType = {|
  isTeams: boolean,
  stageId: number,
  players: PlayerType[]
|};

export type FrameUpdateType = {|
  frame: number,
  seed: number,
  playerIndex: number,
  isFollower: boolean,
  internalCharacterId: number,
  actionStateId: number,
  positionX: number,
  positionY: number,
  facingDirection: number,
  joystickX: number,
  joystickY: number,
  cStickX: number,
  cStickY: number,
  trigger: number,
  buttons: number,
  percent: number,
  shieldSize: number,
  lastAttackLanded: number,
  currentComboCount: number,
  lastHitBy: number,
  stocksRemaining: number,
  physicalButtons: number,
  physicalLTrigger: number,
  physicalRTrigger: number,
|};

export type GameEndType = {|
  gameEndMethod: number,
|};

export function openSlpFile(path: string): SlpFileType {
  const fd = fs.openSync(path, "r");

  const rawDataPosition = getRawDataPosition(fd);
  const rawDataLength = getRawDataLength(fd, rawDataPosition);
  const messageSizes = getMessageSizes(fd, rawDataPosition);

  return {
    fileDescriptor: fd,
    rawDataPosition: rawDataPosition,
    rawDataLength: rawDataLength,
    messageSizes: messageSizes
  };
}

// This function gets the position where the raw data starts
function getRawDataPosition(fd) {
  const buffer = new Uint8Array(1);
  // $FlowFixMe
  fs.readSync(fd, buffer, 0, buffer.length, 0);

  if (buffer[0] === 0x36) {
    return 0;
  }

  if (buffer[0] !== '{'.charCodeAt(0)) {
    return 0; // return error?
  }

  return 15;
}

function getRawDataLength(fd: number, position: number) {
  if (position === 0) {
    const fileStats = fs.fstatSync(fd) || {};
    return fileStats.size;
  }

  const buffer = new Uint8Array(4);
  // $FlowFixMe
  fs.readSync(fd, buffer, 0, buffer.length, position - 4);

  return buffer[0] << 24 | buffer[1] << 16 | buffer[2] << 8 | buffer[3];
}

function getMessageSizes(fd: number, position: number): { [command: number]: number } {
  const messageSizes: { [command: number]: number } = {};
  // Support old file format
  if (position === 0) {
    messageSizes[0x36] = 0x140;
    messageSizes[0x37] = 0x6;
    messageSizes[0x38] = 0x46;
    messageSizes[0x39] = 0x1;
    return messageSizes;
  }

  const buffer = new Uint8Array(2);
  // $FlowFixMe
  fs.readSync(fd, buffer, 0, buffer.length, position);
  if (buffer[0] !== Commands.MESSAGE_SIZES) {
    return {};
  }

  const payloadLength = buffer[1];
  messageSizes[0x35] = payloadLength;

  const messageSizesBuffer = new Uint8Array(payloadLength - 1);
  // $FlowFixMe
  fs.readSync(fd, messageSizesBuffer, 0, messageSizesBuffer.length, position + 2);
  for (let i = 0; i < payloadLength - 1; i += 3) {
    const command = messageSizesBuffer[i];

    // Get size of command
    messageSizes[command] = messageSizesBuffer[i + 1] << 8 | messageSizesBuffer[i + 2];
  }

  return messageSizes;
}

type EventPayloadTypes = GameStartType | FrameUpdateType | GameEndType;
type EventCallbackFunc = (command: number, payload: ?EventPayloadTypes) => boolean;
export function iterateEvents(slpFile: SlpFileType, callback: EventCallbackFunc) {
  const fd = slpFile.fileDescriptor;

  let readPosition = slpFile.rawDataPosition;
  const stopReadingAt = readPosition + slpFile.rawDataLength;

  // Generate read buffers for each
  const commandPayloadBuffers = _.mapValues(slpFile.messageSizes, (size) => (
    new Uint8Array(size + 1)
  ));

  const commandByteBuffer = new Uint8Array(1);
  while (readPosition < stopReadingAt) {
    // $FlowFixMe
    fs.readSync(fd, commandByteBuffer, 0, 1, readPosition);
    const commandByte = commandByteBuffer[0];
    const buffer = commandPayloadBuffers[commandByte];
    if (buffer === undefined) {
      // If we don't have an entry for this command, return false to indicate failed read
      return false;
    }

    fs.readSync(fd, buffer, 0, buffer.length, readPosition);
    const parsedPayload = parseMessage(commandByte, buffer);
    const shouldStop = callback(commandByte, parsedPayload);
    if (shouldStop) {
      break;
    }

    readPosition += buffer.length;
  }

  return true;
}

function parseMessage(command, payload): ?EventPayloadTypes {
  const view = new DataView(payload.buffer);
  switch (command) {
  case Commands.GAME_START:
    return {
      isTeams: !!view.getUint8(0xD),
      stageId: view.getUint16(0x13),
      players: _.map([0, 1, 2, 3], playerIndex => {
        const offset = playerIndex * 0x24;
        return {
          port: playerIndex + 1,
          characterId: view.getUint8(0x65 + offset),
          characterColor: view.getUint8(0x68 + offset),
          type: view.getUint8(0x66 + offset),
          teamId: view.getUint8(0x6E + offset)
        };
      })
    };
  case Commands.FRAME_UPDATE:
    return {
      frame: view.getInt32(0x1),
      seed: view.getUint32(0x5),
      playerIndex: view.getUint8(0x9),
      isFollower: !!view.getUint8(0xA),
      internalCharacterId: view.getUint8(0xB),
      actionStateId: view.getUint16(0xC),
      positionX: view.getFloat32(0xE),
      positionY: view.getFloat32(0x12),
      facingDirection: view.getFloat32(0x16),
      joystickX: view.getFloat32(0x1A),
      joystickY: view.getFloat32(0x1E),
      cStickX: view.getFloat32(0x22),
      cStickY: view.getFloat32(0x26),
      trigger: view.getFloat32(0x2A),
      buttons: view.getUint32(0x2E),
      percent: view.getFloat32(0x32),
      shieldSize: view.getFloat32(0x36),
      lastAttackLanded: view.getUint8(0x3A),
      currentComboCount: view.getUint8(0x3B),
      lastHitBy: view.getUint8(0x3C),
      stocksRemaining: view.getUint8(0x3D),
      physicalButtons: view.getUint16(0x3E),
      physicalLTrigger: view.getFloat32(0x40),
      physicalRTrigger: view.getFloat32(0x44)
    };
  case Commands.GAME_END:
    return {
      gameEndMethod: view.getUint8(0x1)
    };
  default:
    return null;
  }
}

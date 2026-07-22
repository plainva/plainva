import { concatBytes } from "../crypto/cryptoPrimitives.js";
import { protocolAssert } from "./errors.js";

export class BinaryWriter {
  private readonly parts: Uint8Array[] = [];

  bytes(value: Uint8Array): this {
    this.parts.push(value);
    return this;
  }

  u8(value: number): this {
    protocolAssert(Number.isInteger(value) && value >= 0 && value <= 0xff, "bounds", "u8 out of range");
    return this.bytes(new Uint8Array([value]));
  }

  u16(value: number): this {
    protocolAssert(Number.isInteger(value) && value >= 0 && value <= 0xffff, "bounds", "u16 out of range");
    return this.bytes(new Uint8Array([(value >>> 8) & 0xff, value & 0xff]));
  }

  u32(value: number): this {
    protocolAssert(Number.isInteger(value) && value >= 0 && value <= 0xffffffff, "bounds", "u32 out of range");
    return this.bytes(new Uint8Array([
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ]));
  }

  u64(value: number): this {
    protocolAssert(Number.isSafeInteger(value) && value >= 0, "bounds", "u64 out of range");
    const out = new Uint8Array(8);
    let remaining = BigInt(value);
    for (let index = 7; index >= 0; index -= 1) {
      out[index] = Number(remaining & 0xffn);
      remaining >>= 8n;
    }
    return this.bytes(out);
  }

  finish(): Uint8Array {
    return concatBytes(...this.parts);
  }
}

export class BinaryReader {
  private cursor = 0;

  constructor(private readonly input: Uint8Array) {}

  get offset(): number {
    return this.cursor;
  }

  get remaining(): number {
    return this.input.length - this.cursor;
  }

  bytes(length: number): Uint8Array {
    protocolAssert(Number.isInteger(length) && length >= 0, "bounds", "invalid byte length");
    protocolAssert(length <= this.remaining, "format", "truncated binary frame");
    const value = this.input.subarray(this.cursor, this.cursor + length);
    this.cursor += length;
    return value;
  }

  u8(): number {
    return this.bytes(1)[0];
  }

  u16(): number {
    const bytes = this.bytes(2);
    return bytes[0] * 0x100 + bytes[1];
  }

  u32(): number {
    const bytes = this.bytes(4);
    return bytes[0] * 0x1000000 + bytes[1] * 0x10000 + bytes[2] * 0x100 + bytes[3];
  }

  u64(): number {
    const bytes = this.bytes(8);
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    protocolAssert(value <= BigInt(Number.MAX_SAFE_INTEGER), "bounds", "u64 exceeds safe integer range");
    return Number(value);
  }

  done(): void {
    protocolAssert(this.remaining === 0, "format", "unexpected trailing bytes");
  }
}

import { describe, expect, it } from 'vitest';
import {
  decodeFloat32Array,
  encodeFloat32Array,
} from '@main/db/kb';

describe('float32 BLOB 编解码工具（little-endian）', () => {
  it('roundtrip 保留常见浮点值', () => {
    const nums = [0.5, -1.25, 3.14159, 0, 768.0, -0.0001];
    const buf = encodeFloat32Array(nums);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(nums.length * 4);
    const decoded = decodeFloat32Array(buf);
    expect(decoded.length).toBe(nums.length);
    for (let i = 0; i < nums.length; i++) {
      expect(decoded[i]).toBeCloseTo(nums[i], 5);
    }
  });

  it('空数组 roundtrip 为空 Buffer', () => {
    const buf = encodeFloat32Array([]);
    expect(buf.length).toBe(0);
    expect(decodeFloat32Array(buf).length).toBe(0);
  });

  it('decode 非 4 对齐 Buffer 截断到末尾完整元素', () => {
    // 7 字节 = 1 个完整 float32 + 3 个残留字节
    const buf = Buffer.concat([encodeFloat32Array([1.5]), Buffer.from([0, 0, 0])]);
    const decoded = decodeFloat32Array(buf);
    expect(decoded.length).toBe(1);
    expect(decoded[0]).toBeCloseTo(1.5, 5);
  });

  it('little-endian 字节序正确（1.0 → 00 00 80 3F）', () => {
    const buf = encodeFloat32Array([1]);
    expect([...buf]).toEqual([0x00, 0x00, 0x80, 0x3f]);
  });
});

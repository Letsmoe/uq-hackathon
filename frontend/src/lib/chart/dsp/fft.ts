/** In-place radix-2 Cooley-Tukey FFT over separate real and imaginary arrays. */
export class FastFourierTransform {
  private readonly size: number;
  private readonly bitCount: number;
  private readonly reversedIndices: Uint32Array;
  private readonly cosineTable: Float32Array;
  private readonly sineTable: Float32Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, got ${size}`);
    }

    this.size = size;
    this.bitCount = Math.log2(size);
    this.reversedIndices = buildBitReversalTable(size, this.bitCount);
    this.cosineTable = new Float32Array(size / 2);
    this.sineTable = new Float32Array(size / 2);

    this.fillTwiddleTables();
  }

  forward(real: Float32Array, imaginary: Float32Array): void {
    this.applyBitReversalPermutation(real, imaginary);

    for (let halfSize = 1; halfSize < this.size; halfSize *= 2) {
      this.runButterflyStage(real, imaginary, halfSize);
    }
  }

  /** Magnitude of bins 0..size/2, which is all a real input carries. */
  magnitudes(real: Float32Array, imaginary: Float32Array, into: Float32Array): void {
    for (let bin = 0; bin <= this.size / 2; bin++) {
      into[bin] = Math.hypot(real[bin], imaginary[bin]);
    }
  }

  private fillTwiddleTables(): void {
    for (let index = 0; index < this.size / 2; index++) {
      const angle = (-2 * Math.PI * index) / this.size;

      this.cosineTable[index] = Math.cos(angle);
      this.sineTable[index] = Math.sin(angle);
    }
  }

  private applyBitReversalPermutation(real: Float32Array, imaginary: Float32Array): void {
    for (let index = 0; index < this.size; index++) {
      const target = this.reversedIndices[index];

      if (target <= index) continue;

      swap(real, index, target);
      swap(imaginary, index, target);
    }
  }

  private runButterflyStage(real: Float32Array, imaginary: Float32Array, halfSize: number): void {
    const blockSize = halfSize * 2;

    for (let blockStart = 0; blockStart < this.size; blockStart += blockSize) {
      this.runButterflyBlock(real, imaginary, blockStart, halfSize);
    }
  }

  private runButterflyBlock(
    real: Float32Array,
    imaginary: Float32Array,
    blockStart: number,
    halfSize: number,
  ): void {
    const twiddleStride = this.size / (2 * halfSize);

    for (let offset = 0; offset < halfSize; offset++) {
      const twiddle = offset * twiddleStride;
      const cosine = this.cosineTable[twiddle];
      const sine = this.sineTable[twiddle];
      const top = blockStart + offset;
      const bottom = top + halfSize;
      const rotatedReal = real[bottom] * cosine - imaginary[bottom] * sine;
      const rotatedImaginary = real[bottom] * sine + imaginary[bottom] * cosine;

      real[bottom] = real[top] - rotatedReal;
      imaginary[bottom] = imaginary[top] - rotatedImaginary;
      real[top] += rotatedReal;
      imaginary[top] += rotatedImaginary;
    }
  }
}

function buildBitReversalTable(size: number, bitCount: number): Uint32Array {
  const table = new Uint32Array(size);

  for (let index = 0; index < size; index++) {
    table[index] = reverseBits(index, bitCount);
  }

  return table;
}

function reverseBits(value: number, bitCount: number): number {
  let reversed = 0;

  for (let bit = 0; bit < bitCount; bit++) {
    reversed = (reversed << 1) | ((value >> bit) & 1);
  }

  return reversed >>> 0;
}

function swap(values: Float32Array, left: number, right: number): void {
  const held = values[left];

  values[left] = values[right];
  values[right] = held;
}

import type { InstanceUpload } from "../types/frame-stats.types.ts";

/**
 * Records the instance-buffer writes of the current frame, so callers can see
 * exactly how many bytes reached the GPU (0 for an unchanged scene).
 */
export class UploadMeter {
  private uploads: InstanceUpload[] = [];

  /** Forgets the previous frame's writes. */
  beginFrame(): void {
    this.uploads = [];
  }

  record(upload: InstanceUpload): void {
    this.uploads.push(upload);
  }

  /** The writes recorded since the last {@link UploadMeter.beginFrame}. */
  getUploads(): readonly InstanceUpload[] {
    return this.uploads;
  }

  /** Total bytes written since the last {@link UploadMeter.beginFrame}. */
  getBytes(): number {
    return this.uploads.reduce((sum, upload) => sum + upload.byteLength, 0);
  }
}

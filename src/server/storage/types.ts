// Contract for private file storage (local folder now, object storage later).
// Keys are relative paths like "licences/<userId>/front.jpg".

export interface StoredFile {
  key: string;
  size: number;
  contentType: string;
}

export interface FileStorage {
  readonly name: string;
  put(key: string, data: Buffer | Uint8Array, contentType: string): Promise<StoredFile>;
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
export async function fileDigest(path:string) {
  const hash=createHash("sha256");
  for await(const chunk of createReadStream(path,{highWaterMark:64*1024}))hash.update(chunk);
  return hash.digest("hex");
}

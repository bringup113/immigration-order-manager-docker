import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import { DomainError } from "@/lib/domain";
import { detectMaterialFile, MAX_MATERIAL_FILE_SIZE } from "@/lib/material-files";
import { storageRoot } from "@/lib/file-storage-node";

const counts = new Map<string,number>();
export function acquireTransfer(kind:string, limit:number) {
  const count=counts.get(kind) || 0;
  if (count>=limit) throw new DomainError("当前文件任务较多，请稍后重试。",429);
  counts.set(kind,count+1);
  let released=false;
  return () => {if(!released){released=true;counts.set(kind,(counts.get(kind)||1)-1);}};
}

export async function receiveMaterialUpload(request:Request, allowedFields = ["orderNo","materialId","replaceFileId","reason"]) {
  const maxRequest=MAX_MATERIAL_FILE_SIZE+64*1024;
  if(Number(request.headers.get("content-length"))>maxRequest) throw new DomainError("上传请求过大。",413);
  if(!request.body) throw new DomainError("请选择文件。");
  let parser:ReturnType<typeof Busboy>;
  try {
    parser=Busboy({headers:{"content-type":request.headers.get("content-type") || ""},defParamCharset:"utf8",
      limits:{files:1,fileSize:MAX_MATERIAL_FILE_SIZE+1,fields:4,fieldSize:4096,parts:6,headerPairs:30}});
  } catch {throw new DomainError("上传格式不正确。");}
  const temporaryRoot=join(storageRoot(),".incoming");
  await mkdir(temporaryRoot,{recursive:true,mode:0o700});
  const directory=await mkdtemp(join(temporaryRoot,"upload-"));
  const path=join(directory,"content");
  const cleanup=()=>rm(directory,{recursive:true,force:true});
  const fields:Record<string,string>=Object.create(null);
  let filename="";
  let bytes=0;
  let head=Buffer.alloc(0);
  let total=0;
  let fileTask:Promise<void> | undefined;
  let failure:Error | undefined;
  const hash=createHash("sha256");
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(120000)]);
  const fail=(error:Error) => { failure??=error; queueMicrotask(()=>{if(!parser.destroyed)parser.destroy(error);}); };
  parser.on("field",(name,value,info)=>{
    if(!allowedFields.includes(name) || Object.hasOwn(fields,name) || info.valueTruncated || info.nameTruncated) fail(new DomainError("上传字段不正确或过长。"));
    else fields[name]=value.trim();
  });
  for(const event of ["filesLimit","fieldsLimit","partsLimit"] as const) parser.on(event,()=>fail(new DomainError("每次只能上传一个文件，且字段数量不能超限。",413)));
  parser.on("file",(name,file,info)=>{
    if(name!=="file" || fileTask){file.resume();fail(new DomainError("请选择一个材料文件。"));return;}
    filename=info.filename;
    file.on("limit",()=>fail(new DomainError("单个文件不能超过 20 MB。",413)));
    const meter=new Transform({transform(chunk:Buffer,_encoding,callback){
      bytes+=chunk.length;
      if(bytes>MAX_MATERIAL_FILE_SIZE){callback(new DomainError("单个文件不能超过 20 MB。",413));return;}
      if(head.length<12)head=Buffer.concat([head,chunk.subarray(0,12-head.length)]);
      hash.update(chunk);callback(null,chunk);
    }});
    fileTask=pipeline(file,meter,createWriteStream(path,{flags:"wx",mode:0o600}),{signal});
    void fileTask.catch(fail);
  });
  const requestMeter=new Transform({transform(chunk:Buffer,_encoding,callback){
    total+=chunk.length;
    callback(total>maxRequest ? new DomainError("上传请求过大。",413) : null,chunk);
  }});
  try {
    await pipeline(Readable.fromWeb(request.body as NodeReadableStream<Uint8Array>),requestMeter,parser,{signal});
    if(fileTask)await fileTask;
    if(failure)throw failure;
    if(!filename || !bytes)throw new DomainError("不能上传空文件。");
    const detected=detectMaterialFile(head);
    return {fields,path,name:filename,size:bytes,sha256:hash.digest("hex"),detected,cleanup};
  } catch(error) {
    if(fileTask)await fileTask.catch(()=>undefined);
    await cleanup();
    if(failure)throw failure;
    if(error instanceof DomainError)throw error;
    throw new DomainError(signal.aborted ? "上传已中断或超时，请重试。" : "上传数据不完整，请重试。",400);
  }
}

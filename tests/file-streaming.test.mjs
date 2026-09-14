import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {byteRange} from '../lib/byte-range.ts';
import {fileDigest} from '../lib/file-digest.ts';
test('byte ranges cover closed, open, suffix, clipped and invalid ranges',()=>{
 assert.deepEqual(byteRange('bytes=0-4',20),{start:0,end:4});
 assert.deepEqual(byteRange('bytes=10-',20),{start:10,end:19});
 assert.deepEqual(byteRange('bytes=-5',20),{start:15,end:19});
 assert.deepEqual(byteRange('bytes=-100',20),{start:0,end:19});
 assert.deepEqual(byteRange('bytes=10-100',20),{start:10,end:19});
 for(const value of ['bytes=20-','bytes=7-2','bytes=-0','bytes=-','bytes=0-1,4-5','bytes=9007199254740999-','units=0-1'])assert.equal(byteRange(value,20),null,value);
 assert.equal(byteRange('bytes=0-',0),null);
});
test('streamed checksums preserve SHA-256 across multiple chunks',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'migra-digest-test-'));
 try {const content=Buffer.alloc(3*1024*1024+3,0x61);const path=join(dir,'fixture');await writeFile(path,content);assert.equal(await fileDigest(path),createHash('sha256').update(content).digest('hex'));}
 finally{await rm(dir,{recursive:true,force:true});}
});

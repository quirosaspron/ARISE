import * as THREE from 'three';

const base=new URL('./assets/go2-fast/',import.meta.url);
const types={Float32Array,Uint16Array,Uint32Array,Int16Array,Uint8Array,Int8Array};

async function request(name){
  const response=await fetch(new URL(name,base),{cache:'force-cache'});
  if(!response.ok)throw new Error(`Robot asset ${name}: ${response.status}`);
  return response;
}

async function readBinary(){
  if(typeof DecompressionStream==='function'){
    try{
      const response=await request('meshpack.bin.gz');
      const bytes=await response.arrayBuffer();
      const header=new Uint8Array(bytes,0,2);
      // A host may already have decoded Content-Encoding: gzip.
      if(header[0]!==0x1f||header[1]!==0x8b)return bytes;
      return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }catch(error){console.warn('ARISE: using uncompressed binary model.',error);}
  }
  return (await request('meshpack.bin')).arrayBuffer();
}

export async function loadPackedModels(){
  const [manifest,binary]=await Promise.all([request('meshpack.json').then(r=>r.json()),readBinary()]);
  if(manifest.version!==1)throw new Error('Unsupported robot model format');
  const geometries=manifest.geometries.map(record=>{
    const geometry=new THREE.BufferGeometry();
    for(const [name,a] of Object.entries(record.attributes)){
      geometry.setAttribute(name,new THREE.BufferAttribute(new types[a.type](binary,a.offset,a.length),a.itemSize,a.normalized));
    }
    if(record.index){const a=record.index;geometry.setIndex(new THREE.BufferAttribute(new types[a.type](binary,a.offset,a.length),1));}
    for(const group of record.groups)geometry.addGroup(group.start,group.count,group.materialIndex);
    return geometry;
  });
  const materials=manifest.materials.map(json=>new THREE.MaterialLoader().parse(json));
  function build(record){
    const node=record.geometry===undefined?new THREE.Group():new THREE.Mesh(geometries[record.geometry],record.material.length===1?materials[record.material[0]]:record.material.map(i=>materials[i]));
    node.name=record.name;
    node.matrix.fromArray(record.matrix);
    node.matrix.decompose(node.position,node.quaternion,node.scale);
    for(const child of record.children)node.add(build(child));
    return node;
  }
  return new Map(Object.entries(manifest.parts).map(([name,record])=>[name,build(record)]));
}

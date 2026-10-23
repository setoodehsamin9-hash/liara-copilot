/** Minimal empty-file ZIP for local UI/parser tests; never sent to Liara. */
export function makeTestZip(names: string[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const name of names) {
    const bytes = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30 + bytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(bytes.length, 26);
    bytes.copy(local, 30);
    locals.push(local);
    const record = Buffer.alloc(46 + bytes.length);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(bytes.length, 28);
    record.writeUInt32LE(offset, 42);
    bytes.copy(record, 46);
    central.push(record);
    offset += local.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

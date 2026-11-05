export const keyRotationProgram = String.raw`import sys,json,os,pwd,stat,shlex,fcntl,secrets,re
config=json.load(sys.stdin)
assert config['action'] in ('ADD','RETIRE')
def blob(public):
 parts=public.strip().split()
 assert len(parts)>=2 and parts[0]=='ssh-ed25519'
 return parts[1]
new=blob(config['newPublicKey']); old=blob(config['oldPublicKey']); assert new!=old
def line_blob(line):
 if not line.strip() or line.lstrip().startswith('#'): return None
 tokens=shlex.shlex(line,posix=True); tokens.whitespace_split=True; tokens.commenters=''
 for token in tokens:
  if token=='ssh-ed25519': return next(tokens,None)
 return None
def replacement_line(line):
 pattern=r'(?<!\S)ssh-ed25519[ \t]+'+re.escape(old)+r'(?=[ \t\r\n]|$)'
 for match in re.finditer(pattern,line):
  try: shlex.split(line[:match.start()],comments=False)
  except ValueError: continue
  result=line[:match.start()]+'ssh-ed25519 '+new+line[match.end():]
  assert line_blob(result)==new
  return result.rstrip('\r\n')+'\n'
 raise ValueError('unsupported authorized key line')
home=pwd.getpwuid(os.getuid()).pw_dir
directory=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
try:
 for part in home.split('/')[1:]+['.ssh']:
  replacement=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=directory)
  os.close(directory); directory=replacement
 assert os.fstat(directory).st_uid==os.getuid() and os.fstat(directory).st_mode&0o022==0
 lock=os.open('.infradeck-key-rotation.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600,dir_fd=directory)
 assert os.fstat(lock).st_uid==os.getuid() and os.fstat(lock).st_nlink==1
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 descriptor=os.open('authorized_keys',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=directory)
 with os.fdopen(descriptor,'rb') as source:
  before=os.fstat(source.fileno())
  assert stat.S_ISREG(before.st_mode) and before.st_uid==os.getuid() and before.st_nlink==1 and before.st_size<=1048576 and before.st_mode&0o022==0
  data=source.read(1048577); assert len(data)<=1048576
 lines=data.decode('utf8').splitlines(keepends=True)
 keys=[line_blob(line) for line in lines]
 if config['action']=='ADD':
  assert old in keys or new in keys
  updated=data if new in keys else data+(b'' if not data or data.endswith(b'\n') else b'\n')+''.join(replacement_line(line) for line,key in zip(lines,keys) if key==old).encode('utf8')
 else:
  assert new in keys
  updated=''.join(line for line,key in zip(lines,keys) if key!=old).encode('utf8')
 if updated!=data:
  temporary='.infradeck-key-'+secrets.token_hex(16)
  try:
   output=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=directory)
   with os.fdopen(output,'wb') as target: target.write(updated); target.flush(); os.fsync(target.fileno())
   current=os.stat('authorized_keys',dir_fd=directory,follow_symlinks=False)
   assert (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(current.st_dev,current.st_ino,current.st_size,current.st_mtime_ns,current.st_ctime_ns)
   os.rename(temporary,'authorized_keys',src_dir_fd=directory,dst_dir_fd=directory); os.fsync(directory)
  finally:
   try: os.unlink(temporary,dir_fd=directory)
   except FileNotFoundError: pass
finally: os.close(directory)
`;

export function keyRotationCommand() {
  return (
    "python3 -c 'import base64;exec(base64.b64decode(\"" +
    Buffer.from(keyRotationProgram).toString("base64") +
    "\"))'"
  );
}

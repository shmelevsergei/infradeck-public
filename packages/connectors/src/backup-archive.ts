import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { z } from "zod";

export const backupInputSchema = z
  .object({
    directories: z
      .array(
        z
          .string()
          .max(512)
          .regex(/^\/srv\/[A-Za-z0-9_./-]+$/)
          .refine(
            (value) =>
              !value.split("/").some((part) => part === ".." || part === "."),
          ),
      )
      .max(8),
    databases: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,62}$/)).max(8),
  })
  .refine((value) => value.directories.length + value.databases.length > 0);
export const recoveryKeySchema = z.string().regex(/^[a-f0-9]{64}$/);
const fileSchema = z.object({
  path: z
    .string()
    .max(1024)
    .regex(/^(files\/[0-7]\/|postgres\/)[a-zA-Z0-9_./-]+$/)
    .refine(
      (value) =>
        !value
          .split("/")
          .some((part) => part === ".." || part === "." || part === ""),
    ),
  data: z
    .string()
    .max(24 * 1024 * 1024)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const bundleSchema = z.object({
  version: z.literal(1),
  files: z.array(fileSchema).max(1000),
});
export function validateBundle(raw: unknown) {
  const bundle = bundleSchema.parse(raw);
  let size = 0;
  const names = new Set<string>();
  for (const file of bundle.files) {
    const data = Buffer.from(file.data, "base64");
    size += data.length;
    if (
      names.has(file.path) ||
      size > 16 * 1024 * 1024 ||
      createHash("sha256").update(data).digest("hex") !== file.sha256
    )
      throw new Error("Invalid archive integrity or limits");
    names.add(file.path);
  }
  return bundle;
}
export function encryptArchive(
  raw: unknown,
  recoveryKey: string,
  identity: string,
) {
  const bundle = validateBundle(raw);
  const nonce = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(recoveryKeySchema.parse(recoveryKey), "hex"),
    nonce,
  );
  cipher.setAAD(Buffer.from(identity));
  const ciphertext = Buffer.concat([
    cipher.update(gzipSync(JSON.stringify(bundle))),
    cipher.final(),
  ]);
  return Buffer.concat([
    Buffer.from("IDB1"),
    nonce,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}
export function decryptArchive(
  archive: Buffer,
  recoveryKey: string,
  identity: string,
) {
  if (
    archive.length < 32 ||
    archive.length > 24 * 1024 * 1024 ||
    archive.subarray(0, 4).toString() !== "IDB1"
  )
    throw new Error("Invalid archive");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(recoveryKeySchema.parse(recoveryKey), "hex"),
    archive.subarray(4, 16),
  );
  decipher.setAAD(Buffer.from(identity));
  decipher.setAuthTag(archive.subarray(16, 32));
  const compressed = Buffer.concat([
    decipher.update(archive.subarray(32)),
    decipher.final(),
  ]);
  return validateBundle(
    JSON.parse(
      gunzipSync(compressed, { maxOutputLength: 24 * 1024 * 1024 }).toString(
        "utf8",
      ),
    ),
  );
}

export const backupProgram = String.raw`import sys,json,os,stat,base64,hashlib,subprocess,tempfile,resource,signal,fcntl,re
def deadline(signum,frame): raise TimeoutError('backup deadline')
signal.signal(signal.SIGALRM,deadline); signal.alarm(220)
os.umask(0o077)
resource.setrlimit(resource.RLIMIT_AS,(268435456,268435456))
resource.setrlimit(resource.RLIMIT_CPU,(120,120))
resource.setrlimit(resource.RLIMIT_FSIZE,(16777216,16777216))
config=json.load(sys.stdin)
assert re.fullmatch('[a-f0-9-]{73}',config['lockId'])
lock=os.open('/tmp/infradeck-backup-'+config['lockId']+'.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
assert os.fstat(lock).st_uid==os.getuid() and os.fstat(lock).st_nlink==1
fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
release={}
for line in open('/etc/os-release'):
 if '=' in line:
  key,value=line.strip().split('=',1); release[key]=value.strip('"')
assert (release.get('ID'),release.get('VERSION_ID')) in [('ubuntu','22.04'),('ubuntu','24.04'),('debian','12'),('debian','13')]
assert (3,10)<=sys.version_info[:2]<=(3,13)
files=[]; total=0
def directory_descriptor(path):
 descriptor=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
 try:
  for part in path.split('/')[1:]:
   replacement=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=descriptor)
   os.close(descriptor); descriptor=replacement
  return descriptor
 except BaseException:
  os.close(descriptor); raise
def append(path,data):
 global total
 total+=len(data)
 assert total<=16777216 and len(files)<1000
 files.append(dict(path=path,data=base64.b64encode(data).decode(),sha256=hashlib.sha256(data).hexdigest()))
for index,directory in enumerate(config['directories']):
 assert directory.startswith('/srv/') and os.path.realpath(directory)==directory and os.path.isdir(directory)
 ancestor=directory
 while ancestor!='/':
  assert not os.path.exists(os.path.join(ancestor,'PG_VERSION')) and not os.path.exists(os.path.join(ancestor,'postmaster.pid'))
  ancestor=os.path.dirname(ancestor)
 for root,dirs,names in os.walk(directory,followlinks=False):
  assert 'PG_VERSION' not in names and 'postmaster.pid' not in names
  for entry in dirs+names:
   metadata=os.lstat(os.path.join(root,entry))
   assert stat.S_ISDIR(metadata.st_mode) or (stat.S_ISREG(metadata.st_mode) and metadata.st_nlink==1)
  for name in sorted(names):
   assert not name.lower().endswith(('.db','.sqlite','.sqlite3','.ibd','.myd','.myi','-wal','-shm'))
   path=os.path.join(root,name)
   parent=directory_descriptor(os.path.dirname(path))
   try: descriptor=os.open(os.path.basename(path),os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent)
   finally: os.close(parent)
   with os.fdopen(descriptor,'rb') as source:
    before=os.fstat(source.fileno()); assert stat.S_ISREG(before.st_mode) and before.st_nlink==1
    data=source.read(16777217); after=os.fstat(source.fileno())
    assert before.st_size==after.st_size and before.st_mtime_ns==after.st_mtime_ns
    assert not data.startswith(b'SQLite format 3\x00')
   append('files/'+str(index)+'/'+os.path.relpath(path,directory),data)
for database in config['databases']:
 assert database.replace('_','a').isalnum() and len(database)<=63 and not database.startswith('-')
 version=subprocess.run(['sudo','-n','-u','postgres','pg_dump','--version'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=10,check=True).stdout.decode()
 assert any((' '+str(major)+'.') in version for major in range(14,19))
 query="SET statement_timeout=5000; SELECT current_setting('server_version_num')::int,pg_database_size(current_database())"
 server=subprocess.run(['sudo','-n','-u','postgres','psql','--no-password','--host=/var/run/postgresql','--dbname='+database,'-Atq','--set=ON_ERROR_STOP=1','--command='+query],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=10,check=True).stdout.decode().strip().split('|')
 assert int(server[0])//10000==int(version.split()[2].split('.')[0]) and int(server[1])<=67108864
 with tempfile.TemporaryFile() as output:
  result=subprocess.run(['sudo','-n','-u','postgres','pg_dump','--no-password','--format=custom','--host=/var/run/postgresql','--dbname='+database],stdout=output,stderr=subprocess.DEVNULL,timeout=120)
  assert result.returncode==0
  output.seek(0); append('postgres/'+database+'.dump',output.read(16777217))
json.dump(dict(version=1,files=files),sys.stdout,separators=(',',':'))
`;
export function backupCommand() {
  return (
    "python3 -c 'import base64;exec(base64.b64decode(\"" +
    Buffer.from(backupProgram).toString("base64") +
    "\"))'"
  );
}
export const restoreProgram = String.raw`import sys,json,os,base64,hashlib,subprocess,tempfile,resource,shutil,re,signal,fcntl
def deadline(signum,frame): raise TimeoutError('restore deadline')
signal.signal(signal.SIGALRM,deadline); signal.alarm(220)
os.umask(0o077)
resource.setrlimit(resource.RLIMIT_AS,(268435456,268435456))
resource.setrlimit(resource.RLIMIT_CPU,(120,120))
resource.setrlimit(resource.RLIMIT_FSIZE,(16777216,16777216))
config=json.load(sys.stdin)
assert re.fullmatch('[a-f0-9-]{73}',config['lockId'])
lock=os.open('/tmp/infradeck-restore-'+config['lockId']+'.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
assert os.fstat(lock).st_uid==os.getuid() and os.fstat(lock).st_nlink==1
fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
assert re.fullmatch('[a-f0-9-]{36}',config['taskId'])
prefix=['runuser','-u','postgres','--'] if os.getuid()==0 else ['sudo','-n','-u','postgres']
def run(arguments,input=None):
 return subprocess.run(prefix+arguments,input=input,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=120,check=True).stdout
root=tempfile.mkdtemp(prefix='infradeck-restore-'); created=[]; count=0; verification=[]
try:
 for file in config['bundle']['files']:
  path=file['path']; assert re.fullmatch('(files/[0-7]/|postgres/)[a-zA-Z0-9_./-]+',path)
  assert all(part not in ('','..','.') for part in path.split('/'))
  data=base64.b64decode(file['data'],validate=True)
  assert hashlib.sha256(data).hexdigest()==file['sha256']
  destination=os.path.join(root,path); os.makedirs(os.path.dirname(destination),mode=0o700,exist_ok=True)
  with open(destination,'xb') as output: output.write(data)
  with open(destination,'rb') as restored: assert hashlib.sha256(restored.read()).hexdigest()==file['sha256']
  if path.startswith('postgres/') and path.endswith('.dump'):
   database='idrestore_'+config['taskId'].replace('-','')+'_'+str(count)
   run(['createdb','--no-password','--host=/var/run/postgresql','--template=template0',database]); created.append(database)
   run(['pg_restore','--no-password','--host=/var/run/postgresql','--exit-on-error','--single-transaction','--no-owner','--no-privileges','--no-tablespaces','--dbname='+database],data)
   query="SET statement_timeout=15000; SELECT coalesce(jsonb_object_agg(format('%I.%I',schemaname,tablename),jsonb_build_object('rows',(xpath('/row/c/text()',query_to_xml(format('SELECT count(*) AS c FROM %I.%I',schemaname,tablename),false,true,'')))[1]::text::bigint,'digest',(xpath('/row/h/text()',query_to_xml(format('SELECT md5(coalesce(string_agg(row_to_json(t)::text,chr(10) ORDER BY row_to_json(t)::text),chr(0+32))) AS h FROM %I.%I AS t',schemaname,tablename),false,true,'')))[1]::text)),'{}'::jsonb) FROM pg_tables WHERE schemaname NOT LIKE 'pg_%' AND schemaname <> 'information_schema'"
   verification.append(json.loads(run(['psql','--no-password','--host=/var/run/postgresql','--dbname='+database,'-Atq','--set=ON_ERROR_STOP=1','--command='+query]).decode()))
   count+=1
 print(json.dumps(dict(files=len(config['bundle']['files']),databases=count,status='RESTORED',verification=verification)))
finally:
 for database in created: run(['dropdb','--no-password','--host=/var/run/postgresql',database])
 shutil.rmtree(root)
`;
export function restoreCommand() {
  return (
    "python3 -c 'import base64;exec(base64.b64decode(\"" +
    Buffer.from(restoreProgram).toString("base64") +
    "\"))'"
  );
}

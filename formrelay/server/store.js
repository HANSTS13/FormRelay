const {DatabaseSync}=require('node:sqlite');
const fs=require('fs');
const path=require('path');

// One SQLite connection, one server instance. No ORM or separate database needed.
function createStore(filename=':memory:'){
 if(filename!==':memory:')fs.mkdirSync(path.dirname(path.resolve(filename)),{recursive:true});
 const db=new DatabaseSync(filename);
 db.exec('PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, fields TEXT NOT NULL, owner_hash TEXT NOT NULL, expires INTEGER NOT NULL, answers TEXT); CREATE INDEX IF NOT EXISTS request_expiry ON requests(expires)');
 const insert=db.prepare('INSERT INTO requests(id,fields,owner_hash,expires) VALUES(?,?,?,?)');
 const get=db.prepare('SELECT * FROM requests WHERE id=? AND expires>?');
 const answer=db.prepare('UPDATE requests SET answers=? WHERE id=? AND answers IS NULL AND expires>?');
 const prune=db.prepare('DELETE FROM requests WHERE expires<=?');
 return {
  create(id,r){insert.run(id,JSON.stringify(r.fields),r.ownerHash,r.expires)},
  get(id,now=Date.now()){const r=get.get(id,now);return r?{fields:JSON.parse(r.fields),ownerHash:r.owner_hash,expires:r.expires,answers:r.answers===null?null:JSON.parse(r.answers)}:null},
  answer(id,answers){return answer.run(JSON.stringify(answers),id,Date.now()).changes===1},
  clean(now=Date.now()){prune.run(now)},
  count(){return db.prepare('SELECT count(*) AS total FROM requests').get().total},
  close(){db.close()}
 };
}
module.exports={createStore};

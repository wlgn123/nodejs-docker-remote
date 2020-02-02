'use strict';
var express = require('express');
var bodyParser = require('body-parser');
var app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const {Docker} = require('node-docker-api');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const fs = require('fs')

// cors 허용
app.all('/*', function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "X-Requested-With");
  next();
});

// 백업 파일 생성
const promisifyStream = (stream, name) => new Promise((resolve, reject) => {
  let filename = name.slice(1)+'.sql';
  const file = fs.createWriteStream(filename);

  stream.on('data', data => {
    let n_data = data.toString(); 
    
    file.write(n_data)
  })
  stream.on('end', function() {
    file.end();
    resolve(file, filename);
  })
  stream.on('error', reject)
});

// 컨테이너 목록 가져오기
app.get('/list', async (req, res) => {
  const data = await getContainersList();
  res.json(data);
})

// 컨테이너 데이터 조회
app.get('/listDetail', async (req, res) => {
  const containers = await getContainers();
  let result = containers.map(container => {
    return container.data;
  });

  res.json(result);
})

// 컨테이너 생성
app.post('/create', async (req, res)=>{
  if(!req.body.name) return res.json({msg: "name is null"});
  if(!req.body.port) return res.json({msg: "port is null"});
  if(!req.body.image) return res.json({msg: "image is null"});
  if(!req.body.tag) return res.json({msg: "tag is null"});
  
  let createData;
  // MariaDB의 경우
  if(req.body.image == "mariadb") {
    createData = await createContainer(req.body.name, 'admin', req.body.port, req.body.image, req.body.tag)
  } 
  // Oracle-11g 의 경우
  else if(req.body.image == "jaspeen/oracle-xe-11g") {
    createData = await createContainerForOracle11g(req.body.name, req.body.port, req.body.image, req.body.tag)
  }

  let filterData = await getContainerById(createData.data.Id);
  filterData = getContainerFilterData(filterData);

  return res.json(filterData[0]);
})

// 컨테이너 삭제 
app.post('/delete', async (req, res)=>{
  if(!req.body.name) return res.json({msg: "name is null"});

  let result = {success: false};
  result.success = await deleteContainerByName(req.body.name);

  return res.json(result);
})

// 컨테이너 시작
app.post('/start', async (req, res)=>{
  if(!req.body.name) return res.json({msg: "name is null"});
  const containers = await getContainerByName(req.body.name);
  const result = await startContainer(containers[0]);
  
  return res.json(getContainerFilterData([result]));
})

// 컨테이너 중지
app.post('/stop', async (req, res)=>{
  if(!req.body.name) return res.json({msg: "name is null"});

  const containers = await getContainerByName(req.body.name);
  const result = await stopContainer(containers[0]);

  return res.json(getContainerFilterData([result]));
})


// 데이터베이스 백업
app.post('/backup', async (req, res)=>{
  if(!req.body.name) return res.json({msg: "name is null"});
  if(!req.body.schema) return res.json({msg: "schema is null"});

  const containers = await getContainerByName(req.body.name);
  const stream = await backupDB(containers[0], req.body.schema);
  await promisifyStream(stream, req.body.name).then(data => console.log(data));

  return res.json({result: 'sql'});
});

// 데이터베이스 백업파일 다운로드
app.post('/download', async (req,res)=>{
  if(!req.body.name) return res.json({msg: "name is null"});
  
  const file = fs.readFileSync(__dirname + '/' + req.body.name.slice(1) + '.sql', 'binary');

  res.setHeader('Content-Length', file.length);
  res.writeHead(200, {'Content-Type': 'charset=utf-8'});
  res.write(file, 'binary');
  res.end();
});

// 컨테이너 조회
async function getContainers() {
  let datas = [];

  try {
    const containers = await docker.container.list({all:true});
  
    return containers;
  } catch (error) {
    console.log(error);
  }

  return datas;
}

// 컨테이너 리스트 조회( 데이터 가공 전 )
async function getContainersList() {
  const containers = await getContainers();

  return getContainerFilterData(containers);
}

// 컨테이너 리스트 조회 (데이터 가공 후 )
function getContainerFilterData(containers) {
  let result = containers.map((container)=>{
    let data = {}
    if(container.data.Names) data.name = container.data.Names[0];
    if(container.data.id) data.id = container.data.Id
    if(container.data.State) data.state = container.data.State
    if(container.data.Status) data.status = container.data.Status
    if(container.data.Ports.length > 0) data.port = container.data.Ports[0].PublicPort

    return data;
  });

  return result;
}

async function getContainerByName(name) {
  const containers = await getContainers();

  let selectContainer = containers.filter(container=>{
    return container.data.Names[0] == name;
  });
  
  return selectContainer;
}

async function getContainerById(id) {
  const containers = await getContainers();

  let selectContainer = containers.filter(container=>{
    return container.data.Id == id;
  });

  return selectContainer;
}

// MariaDB 생성
async function createContainer(name, password, port, image, tag) {
  try {
    const container = await docker.container.create({
      Image: image + ":" + tag,
      name: name,
      Env: [
          "MYSQL_ROOT_PASSWORD="+ password
        ,
      ],
      ExposedPorts: {
        "3306/tcp": {}
      },
      HostConfig: {
        PortBindings: {"3306/tcp": [{"HostPort": port}]}
      }
    }).then(container => container.start());
  
    return container;
  } catch(error) {
    console.log(error);
  }
}

// Oracle 11g 생성
async function createContainerForOracle11g(name, port, image, tag) {
  try {
    const container = await docker.container.create({
      Image: image + ":" + tag,
      name: name,
      ExposedPorts: {
        "1521/tcp": {}
      },
      HostConfig: {
        PortBindings: {"1521/tcp": [{"HostPort": port}]}
      }
    }).then(container => container.start());

    return container;
  } catch(error) {
    console.log(error);
  }
}

// 컨테이너 이름을 통해 컨테이너 삭제
async function deleteContainerByName(name) {
  try {
    const containers = await getContainerByName(name);
    return await deleteContainer(containers[0]);
  } catch(error) {
    console.log(error);
    return false;
  }
}
// 컨테이너 삭제
async function deleteContainer(container) {
  try {
    await stopContainer(container).then(container => container.delete({v:true}));
    return true;
  } catch(error) {
    console.log(error)
    return false;
  }
}

// 컨테이너 시작
async function startContainer(container) {
  try {
    return await container.start();
  } catch(error) {
    console.log(error)
    return null;
  }
}

// 컨테이너 정지
async function stopContainer(container) {
  try {
    return await container.stop();
  } catch(error) {
    console.log(error)
    return null;
  }
}

// 마리아디비 백업
async function backupDB(container, schema) {
  try {
    return await container.exec.create({
      AttachStdout: true,
      AttachStderr: true,
      AttachStdin: true,
      Cmd: [ '/usr/bin/mysqldump', '-uroot', '-padmin', schema ]
    }).then(exec =>{
      return exec.start({Detach: false})
    })
    .catch(error => console.log(error));
  } catch(error) {
    console.log(error)
    return null;
  }
}

// Node 서버 시작
var server = app.listen(5100, function(){
  console.log("Docker remote server Open");
});
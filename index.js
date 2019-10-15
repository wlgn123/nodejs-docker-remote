'use strict';
var express = require('express');
var bodyParser = require('body-parser');
var app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const {Docker} = require('node-docker-api');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

app.get('/list', async (req, res) => {
  const data = await getContainersList();
  res.json(data);
})

app.get('/listDetail', async (req, res) => {
  const containers = await getContainers();
  let result = containers.map(container => {
    return container.data;
  });

  res.json(result);
})

app.post('/create', async (req, res)=>{
  if(!req.body.name) return res.json({msg: "name is null"});
  if(!req.body.port) return res.json({msg: "port is null"});
  
  let createData = await createContainer(req.body.name, 'admin', req.body.port)
  let filterData = await getContainerById(createData.data.Id);
  filterData = getContainerFilterData(filterData);

  return res.json(filterData[0]);
})

app.post('/delete', async (req, res)=>{
  if(!req.body.name) return res.json({msg: "name is null"});

  let result = {success: false};
  result.success = await deleteContainerByName(req.body.name);

  return res.json(result);
})

app.post('/start', async (req, res)=>{
  if(!req.body.name) return res.json({msg: "name is null"});
  const containers = await getContainerByName(req.body.name);
  const result = await startContainer(containers[0]);
  
  return res.json(getContainerFilterData([result]));
})

app.post('/stop', async (req, res)=>{
  if(!req.body.name) return res.json({msg: "name is null"});
  const containers = await getContainerByName(req.body.name);
  const result = await stopContainer(containers[0]);

  return res.json(getContainerFilterData([result]));
})

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

async function getContainersList() {
  const containers = await getContainers();

  return getContainerFilterData(containers);
}

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

async function createContainer(name, password, port) {
  try {
    const container = await docker.container.create({
      Image: 'mariadb:latest',
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

async function deleteContainerByName(name) {
  try {
    const containers = await getContainerByName(name);
    return await deleteContainer(containers[0]);
  } catch(error) {
    console.log(error);
    return false;
  }
}

async function deleteContainer(container) {
  try {
    await stopContainer(container).then(container => container.delete({v:true}));
    return true;
  } catch(error) {
    console.log(error)
    return false;
  }
}

async function startContainer(container) {
  try {
    return await container.start();
  } catch(error) {
    console.log(error)
    return null;
  }
}

async function stopContainer(container) {
  try {
    return await container.stop();
  } catch(error) {
    console.log(error)
    return null;
  }
}

var server = app.listen(5100, function(){
  console.log("Docker remote server Open");
});
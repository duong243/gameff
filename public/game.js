import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const socket = io();

const urlParams = new URLSearchParams(window.location.search);
let gameMode = urlParams.get('mode') || 'map1'; 
const roomId = urlParams.get('room') || 'public'; 

const currentWeapon = localStorage.getItem('userCurrentWeapon') || 'pistol'; 
const weaponLevels = JSON.parse(localStorage.getItem('userWeaponLevels')) || { pistol: 1, rifle: 1, sniper: 1, bazooka: 1 };
const myName = localStorage.getItem('loggedInUser') || "Khách";
const isMyAdmin = localStorage.getItem('userIsAdmin') === 'true';

let camera, scene, renderer, controls;
let objects = []; 
let playersMeshes = []; 
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;

let playerGroup;
let leftArm, rightArm, leftLeg, rightLeg, head, gun;
let isThirdPerson = true; 
let isArmed = true; 
let runTime = 0; 
let isDead = false;

let myKills = 0;
let myHeadshots = 0;
let myScore = 0;

let isMelee = false; 
let punchAnimTime = 0; 
const PUNCH_DAMAGE = 15; 
const PUNCH_RANGE = 25; 

let forwardVector = new THREE.Vector3();
let rightVector = new THREE.Vector3();
let direction = new THREE.Vector3();

let velocityY = 0;
let isGrounded = false; 
const GRAVITY = 80; 
const JUMP_FORCE = 35; 

const GROUND_LEVEL = 65; 
const FEET_LEVEL = 25;   
const MAP_BOUNDARY = 700; 

let raycaster = new THREE.Raycaster();
let shootCooldown = 0;
let audioCtx;
let gunKickback = 0;

let otherPlayers = {}; 
let npcs = []; 

const MOUSE_SENSITIVITY = 1.0; 
const PLAYER_SPEED = 160;      

socket.on('forceLogout', (data) => {
    if (data.username === myName) {
        localStorage.clear();
        alert(data.reason);
        window.location.href = '/login.html';
    }
});

init();
animate();

document.addEventListener('contextmenu', event => event.preventDefault());

function createCharacter(color, name = "", isAdmin = false) {
    const group = new THREE.Group();
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xffcc99 });
    const shirtMat = new THREE.MeshLambertMaterial({ color: color }); 
    const pantsMat = new THREE.MeshLambertMaterial({ color: 0x333333 });

    const headGeo = new THREE.BoxGeometry(8, 8, 8);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.set(0, 13, 0); 
    head.userData.isHead = true; 
    group.add(head);

    const bodyGeo = new THREE.BoxGeometry(8, 12, 4);
    const body = new THREE.Mesh(bodyGeo, shirtMat);
    body.position.y = 3; 
    group.add(body);

    const leftShoulder = new THREE.Group();
    leftShoulder.position.set(-5.5, 9, 0); 
    const leftArmMesh = new THREE.Mesh(new THREE.BoxGeometry(3.5, 10, 3.5), shirtMat);
    leftArmMesh.position.set(0, -5, 0); 
    leftShoulder.add(leftArmMesh);
    group.add(leftShoulder);

    const rightShoulder = new THREE.Group();
    rightShoulder.position.set(5.5, 9, 0);
    const rightArmMesh = new THREE.Mesh(new THREE.BoxGeometry(3.5, 10, 3.5), shirtMat);
    rightArmMesh.position.set(0, -5, 0);
    rightShoulder.add(rightArmMesh);
    group.add(rightShoulder);

    const leftHip = new THREE.Group();
    leftHip.position.set(-2.2, -3, 0); 
    const leftLegMesh = new THREE.Mesh(new THREE.BoxGeometry(3.5, 10, 3.5), pantsMat);
    leftLegMesh.position.set(0, -5, 0); 
    leftHip.add(leftLegMesh);
    group.add(leftHip);

    const rightHip = new THREE.Group();
    rightHip.position.set(2.2, -3, 0);
    const rightLegMesh = new THREE.Mesh(new THREE.BoxGeometry(3.5, 10, 3.5), pantsMat);
    rightLegMesh.position.set(0, -5, 0);
    rightHip.add(rightLegMesh);
    group.add(rightHip);

    // TẠO SÚNG THEO LOẠI
    let gunMat, gun;
    if (currentWeapon === 'pistol') {
        gunMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
        gun = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 6), gunMat);
        gun.position.set(0, -8, 2); 
    } else if (currentWeapon === 'rifle') {
        gunMat = new THREE.MeshLambertMaterial({ color: 0x4a5d23 });
        gun = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 14), gunMat);
        gun.position.set(0, -8, 5); 
    } else if (currentWeapon === 'sniper') {
        gunMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
        gun = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 18), gunMat);
        const scope = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 4, 8), new THREE.MeshLambertMaterial({ color: 0x111111 }));
        scope.rotation.x = Math.PI / 2;
        scope.position.set(0, 1, 2);
        gun.add(scope);
        gun.position.set(0, -8, 6); 
    } else if (currentWeapon === 'bazooka') {
        gunMat = new THREE.MeshLambertMaterial({ color: 0x556b2f });
        gun = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 16, 8), gunMat);
        gun.rotation.x = Math.PI / 2;
        gun.position.set(0, -8, 4); 
    }
    rightShoulder.add(gun);

    const nameDiv = document.createElement('div');
    nameDiv.style.position = 'absolute';
    nameDiv.style.color = isAdmin ? '#ff3333' : '#00ff00';
    nameDiv.style.fontWeight = 'bold';
    nameDiv.style.fontSize = '18px';
    nameDiv.style.fontFamily = 'Arial, sans-serif';
    nameDiv.style.textShadow = '2px 2px 2px black';
    nameDiv.style.pointerEvents = 'none';
    nameDiv.style.transform = 'translate(-50%, -50%)';
    nameDiv.style.zIndex = '99';
    nameDiv.style.display = 'none';
    nameDiv.innerText = name + (isAdmin ? " 👑" : "");
    document.body.appendChild(nameDiv);
    group.userData.nameElement = nameDiv;

    return { group, leftArm: leftShoulder, rightArm: rightShoulder, leftLeg: leftHip, rightLeg: rightHip, head, gun };
}

// ... CÁC HÀM TẠO MAP, HEALTHBAR, NPC GIỮ NGUYÊN ...
function createHealthBar() {
    const div = document.createElement('div');
    div.style.position = 'absolute'; div.style.width = '50px'; div.style.height = '6px';
    div.style.backgroundColor = 'red'; div.style.border = '1px solid black';
    div.style.borderRadius = '3px'; div.style.pointerEvents = 'none';
    div.style.transform = 'translate(-50%, -50%)'; div.style.zIndex = '100';
    const bar = document.createElement('div'); bar.style.width = '100%'; bar.style.height = '100%'; bar.style.backgroundColor = '#00ff00';
    div.appendChild(bar); document.body.appendChild(div);
    return { container: div, bar: bar };
}
function createTree(x, z) {
    const group = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(2, 3, 30, 6), new THREE.MeshLambertMaterial({ color: 0x8B4513 }));
    trunk.position.y = 15; group.add(trunk);
    const leavesMat = new THREE.MeshLambertMaterial({ color: 0x228B22 });
    const leaves1 = new THREE.Mesh(new THREE.ConeGeometry(15, 25, 6), leavesMat); leaves1.position.y = 35; group.add(leaves1);
    const leaves2 = new THREE.Mesh(new THREE.ConeGeometry(10, 20, 6), leavesMat); leaves2.position.y = 50; group.add(leaves2);
    group.position.set(x, 0, z); scene.add(group);
    const hitBox = new THREE.Mesh(new THREE.BoxGeometry(4, 30, 4), new THREE.MeshBasicMaterial({visible: false}));
    hitBox.position.set(x, 15, z); scene.add(hitBox); objects.push(hitBox);
}
function createRock(x, z) {
    const rockSize = 15 + Math.random() * 20;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rockSize), new THREE.MeshLambertMaterial({ color: 0x777777 }));
    rock.position.set(x, rockSize/2, z); scene.add(rock); 
    const hitBox = new THREE.Mesh(new THREE.BoxGeometry(rockSize*1.5, rockSize, rockSize*1.5), new THREE.MeshBasicMaterial({visible: false}));
    hitBox.position.set(x, rockSize/2, z); scene.add(hitBox); objects.push(hitBox);
}
function createBuilding(x, z) {
    const group = new THREE.Group();
    const width = 40 + Math.random() * 20; const height = 100 + Math.random() * 150; const depth = 40 + Math.random() * 20;
    const colors = [0x777777, 0x555555, 0x8b7d6b, 0x2c3e50];
    const building = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshLambertMaterial({ color: colors[Math.floor(Math.random()*colors.length)] }));
    building.position.y = height / 2; group.add(building);
    const windowMat = new THREE.MeshBasicMaterial({ color: 0xffffaa }); 
    const rows = Math.floor(height / 25); const cols = Math.floor(width / 20);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (Math.random() > 0.4) { 
                const win = new THREE.Mesh(new THREE.PlaneGeometry(8, 10), windowMat);
                win.position.set((c - cols/2) * 20 + 10, r * 25 + 20, depth/2 + 0.1); group.add(win);
                const winBack = win.clone(); winBack.rotation.y = Math.PI; winBack.position.z = -depth/2 - 0.1; group.add(winBack);
            }
        }
    }
    group.position.set(x, 0, z); scene.add(group);
    const hitBox = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshBasicMaterial({visible: false}));
    hitBox.position.set(x, height/2, z); scene.add(hitBox); objects.push(hitBox);
}
function createDesertHouse(x, z) {
    const group = new THREE.Group(); const wallMat = new THREE.MeshLambertMaterial({ color: 0xd2b48c });
    const wall1 = new THREE.Mesh(new THREE.BoxGeometry(40, 30, 4), wallMat); wall1.position.set(0, 15, -18); group.add(wall1);
    const wall2 = new THREE.Mesh(new THREE.BoxGeometry(40, 15, 4), wallMat); wall2.position.set(0, 7.5, 18); group.add(wall2);
    const wall3 = new THREE.Mesh(new THREE.BoxGeometry(4, 30, 40), wallMat); wall3.position.set(-18, 15, 0); group.add(wall3);
    const wall4 = new THREE.Mesh(new THREE.BoxGeometry(4, 30, 40), wallMat); wall4.position.set(18, 15, 0); group.add(wall4);
    group.position.set(x, 0, z); scene.add(group);
    group.children.forEach(w => {
        const hitBox = new THREE.Mesh(new THREE.BoxGeometry(w.geometry.parameters.width, w.geometry.parameters.height, w.geometry.parameters.depth), new THREE.MeshBasicMaterial({visible: false}));
        hitBox.position.copy(w.position).add(group.position); scene.add(hitBox); objects.push(hitBox);
    });
}
function createDesertHill(x, z) {
    const hillGeo = new THREE.SphereGeometry(30 + Math.random()*20, 8, 8, 0, Math.PI*2, 0, Math.PI/2);
    const hill = new THREE.Mesh(hillGeo, new THREE.MeshLambertMaterial({ color: 0xd2b48c }));
    hill.position.set(x, 0, z); scene.add(hill); objects.push(hill);
}
function buildMap() {
    for (let i = scene.children.length - 1; i >= 0; i--) {
        let obj = scene.children[i];
        if (obj.type !== 'PerspectiveCamera' && obj.type !== 'HemisphereLight' && obj !== playerGroup) scene.remove(obj);
    }
    objects = []; npcs = [];
    playersMeshes = playersMeshes.filter(mesh => mesh.userData.playerId && !mesh.userData.playerId.startsWith('npc_'));

    let floorColor = gameMode === 'desert' ? 0xedc9af : (gameMode === 'city' ? 0x444444 : 0x55aa55);
    let skyColor = gameMode === 'desert' ? 0xffd27f : (gameMode === 'city' ? 0x2c3e50 : 0x87CEEB);
    scene.background = new THREE.Color(skyColor);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshLambertMaterial({ color: floorColor }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0; scene.add(floor);

    if (gameMode === 'practice') {
        for (let i = 0; i < 3; i++) createNPC(100 + (Math.random() - 0.5) * 100, 100 + (Math.random() - 0.5) * 100); 
    } else if (gameMode === 'desert') {
        for(let i=0; i<4; i++) createDesertHouse((Math.random()-0.5)*600, (Math.random()-0.5)*600);
        for(let i=0; i<15; i++) createDesertHill((Math.random()-0.5)*800, (Math.random()-0.5)*800);
        const cactusMat = new THREE.MeshLambertMaterial({ color: 0x2e8b57 });
        for (let i = 0; i < 30; i++) {
            const height = 20 + Math.random() * 30;
            const cactus = new THREE.Mesh(new THREE.BoxGeometry(6, height, 6), cactusMat);
            cactus.position.set((Math.random() - 0.5) * 800, height/2, (Math.random() - 0.5) * 800);
            scene.add(cactus); objects.push(cactus);
        }
    } else if (gameMode === 'city') {
        const gridSize = 4; const spacing = 150; 
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                if (i === gridSize/2 - 1 && j === gridSize/2 - 1) continue;
                if (i === gridSize/2 && j === gridSize/2) continue;
                const x = (i - gridSize/2) * spacing; const z = (j - gridSize/2) * spacing;
                const offsetX = (Math.random() - 0.5) * 20; const offsetZ = (Math.random() - 0.5) * 20;
                createBuilding(x + offsetX, z + offsetZ);
            }
        }
        for(let i=0; i<5; i++) {
            const road = new THREE.Mesh(new THREE.PlaneGeometry(1200, 40), new THREE.MeshBasicMaterial({color: 0x222222}));
            road.rotation.x = -Math.PI / 2; road.position.set(0, 0.1, (i-2)*150); scene.add(road);
        }
    } else {
        for (let i = 0; i < 120; i++) {
            const angle = Math.random() * Math.PI * 2; const radius = 50 + Math.random() * 500; 
            const x = Math.cos(angle) * radius; const z = Math.sin(angle) * radius;
            createTree(x, z);
        }
        for (let i = 0; i < 20; i++) createRock((Math.random() - 0.5) * 800, (Math.random() - 0.5) * 800);
    }
    if (playerGroup && !scene.children.includes(playerGroup)) scene.add(playerGroup);
}
function createNPC(x, z) {
    const npcChar = createCharacter(0xff0000, "NPC", false);
    npcChar.group.position.set(x, FEET_LEVEL, z); 
    npcChar.group.userData.playerId = "npc_" + Math.random();
    npcChar.group.userData.isNPC = true;
    npcChar.group.userData.hp = 100;
    npcChar.healthBar = createHealthBar();
    npcChar.direction = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    scene.add(npcChar.group); playersMeshes.push(npcChar.group); npcs.push(npcChar);
}

function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1.5);
    light.position.set(0, 200, 0); scene.add(light);

    buildMap();

    const myChar = createCharacter(0x0000ff, myName, isMyAdmin);
    playerGroup = myChar.group;
    leftArm = myChar.leftArm; rightArm = myChar.rightArm; leftLeg = myChar.leftLeg; rightLeg = myChar.rightLeg; head = myChar.head; gun = myChar.gun;
    scene.add(playerGroup);
    playerGroup.userData.playerId = socket.id; 
    playerGroup.userData.hp = 100;
    playerGroup.healthBar = createHealthBar(); 

    const fpsGun = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 8), new THREE.MeshLambertMaterial({ color: 0x555555 }));
    fpsGun.position.set(2, -1.5, -3); camera.add(fpsGun); scene.add(camera); window.fpsGun = fpsGun; 

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    controls = new PointerLockControls(camera, document.body);
    controls.pointerSpeed = MOUSE_SENSITIVITY; scene.add(controls.getObject());
    controls.getObject().position.set(0, GROUND_LEVEL, 0); 

    document.addEventListener('mousedown', (e) => { 
        if (e.button === 0) {
            if (!controls.isLocked) controls.lock();
            else if (!isDead) {
                if (isMelee) punch(); 
                else if (isArmed) shoot(); 
            }
        }
    });
    document.addEventListener('keydown', onKeyDown); document.addEventListener('keyup', onKeyUp);

    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(1); renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // SOCKET (Giữ nguyên phần xử lý mạng)
    socket.on('connect', () => {
        if (myName) socket.emit('setPlayerName', myName);
        socket.emit('joinRoom', { roomId: roomId, mode: gameMode });
    });
    socket.on('currentPlayers', (data) => {
        if (data.mode && data.mode !== gameMode) { gameMode = data.mode; buildMap(); }
        const players = data.players;
        if (players[socket.id]) {
            controls.getObject().position.set(players[socket.id].x, GROUND_LEVEL, players[socket.id].z);
            updateHpUI(players[socket.id].hp);
            playerGroup.userData.hp = players[socket.id].hp;
        }
        Object.keys(players).forEach((id) => { if (id !== socket.id) addOtherPlayer(id, players[id]); });
    });
    socket.on('newPlayer', (data) => addOtherPlayer(data.id, data.player));
    socket.on('playerMoved', (data) => {
        const other = otherPlayers[data.id];
        if (other) {
            other.group.position.lerp(new THREE.Vector3(data.player.x, FEET_LEVEL, data.player.z), 0.5);
            other.group.rotation.y = data.player.rotationY;
            other.gun.visible = data.player.isArmed;
            other.group.userData.hp = data.player.hp;
            if (data.player.name && other.group.userData.nameElement) {
                other.group.userData.nameElement.innerText = data.player.name + (data.player.isAdmin ? " 👑" : "");
                other.group.userData.nameElement.style.color = data.player.isAdmin ? '#ff3333' : '#00ff00';
            }
        }
    });
    socket.on('playerDisconnected', (id) => {
        if (otherPlayers[id]) {
            scene.remove(otherPlayers[id].group);
            if(otherPlayers[id].healthBar) otherPlayers[id].healthBar.container.remove();
            if(otherPlayers[id].group.userData.nameElement) otherPlayers[id].group.userData.nameElement.remove();
            playersMeshes = playersMeshes.filter(mesh => mesh !== otherPlayers[id].group);
            delete otherPlayers[id];
        }
    });
    socket.on('hpUpdated', (data) => { if (data.id === socket.id) { updateHpUI(data.hp); playerGroup.userData.hp = data.hp; } });
    socket.on('playerDied', (data) => {
        const { id, isHeadshot, killerId, killerName, victimName } = data;
        if (id === socket.id) {
            isDead = true; playerGroup.rotation.x = -Math.PI / 2; window.fpsGun.visible = false; updateHpUI(0);
            myKills = 0; myHeadshots = 0; myScore = 0;
            document.getElementById('score-display').innerText = myScore;
            document.getElementById('kills-display').innerText = myKills;
            document.getElementById('headshots-display').innerText = myHeadshots;
            if (isHeadshot) addKillFeed(`💀 Bạn đã bị ${killerName} HEADSHOT!`); else addKillFeed(`💀 Bạn đã bị ${killerName} hạ gục!`);
        } else if (otherPlayers[id]) {
            otherPlayers[id].group.rotation.x = -Math.PI / 2;
            if (killerId === socket.id) {
                myKills++;
                if (isHeadshot) { myHeadshots++; myScore += 150; addKillFeed(`🎯 BẠN ĐÃ HEADSHOT ${victimName}! (+150 Điểm)`); } 
                else { myScore += 100; addKillFeed(`🔫 Bạn đã hạ gục ${victimName}! (+100 Điểm)`); }
                document.getElementById('score-display').innerText = myScore;
                document.getElementById('kills-display').innerText = myKills;
                document.getElementById('headshots-display').innerText = myHeadshots;
            } else {
                if (isHeadshot) addKillFeed(`💀 ${killerName} đã HEADSHOT ${victimName}!`); else addKillFeed(`💀 ${killerName} đã hạ gục ${victimName}!`);
            }
        }
    });
    socket.on('playerRespawned', (data) => {
        if (data.id === socket.id) {
            isDead = false; playerGroup.rotation.x = 0;
            controls.getObject().position.set(data.player.x, GROUND_LEVEL, data.player.z);
            updateHpUI(100); playerGroup.userData.hp = 100;
        } else if (otherPlayers[data.id]) {
            otherPlayers[data.id].group.rotation.x = 0;
            otherPlayers[data.id].group.position.set(data.player.x, FEET_LEVEL, data.player.z);
        }
    });
}

// ... CÁC HÀM UPDATE UI, KILLFEED, ADD PLAYER ...
function updateHpUI(hp) {
    const hpBar = document.getElementById('hp-bar'); const hpText = document.getElementById('hp-text');
    if(!hpBar || !hpText) return;
    hpBar.style.width = `${hp}%`; hpText.innerText = `${hp} HP`;
    if (hp > 50) hpBar.style.backgroundColor = '#00ff00';
    else if (hp > 20) hpBar.style.backgroundColor = '#ffff00';
    else hpBar.style.backgroundColor = '#ff0000';
}
function addKillFeed(text) {
    const feed = document.getElementById('killfeed');
    if(!feed) return;
    const msg = document.createElement('div'); 
    msg.innerText = text; msg.style.marginBottom = "10px"; msg.style.color = "#ffcc00"; 
    msg.style.fontSize = "18px"; msg.style.fontWeight = "bold"; msg.style.textShadow = "2px 2px 2px black"; 
    feed.appendChild(msg); setTimeout(() => { if (feed.contains(msg)) feed.removeChild(msg); }, 4000);
}
function addOtherPlayer(id, playerData) {
    const isAdmin = playerData.isAdmin || false;
    const name = playerData.name || "Người chơi";
    const otherChar = createCharacter(0xff0000, name, isAdmin);
    otherChar.group.position.set(playerData.x, FEET_LEVEL, playerData.z);
    otherChar.group.rotation.y = playerData.rotationY;
    otherChar.gun.visible = playerData.isArmed;
    otherChar.group.userData.playerId = id; 
    otherChar.group.userData.hp = playerData.hp;
    otherChar.healthBar = createHealthBar();
    scene.add(otherChar.group); playersMeshes.push(otherChar.group); otherPlayers[id] = otherChar;
}

// ... HÀM SHOOT, PUNCH, ANIMATE ...
function playShootSound() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator(); const gainNode = audioCtx.createGain();
    osc.type = 'square'; osc.frequency.setValueAtTime(150, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    osc.connect(gainNode); gainNode.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + 0.1);
}
function playHitSound() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator(); const gainNode = audioCtx.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);
    osc.connect(gainNode); gainNode.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + 0.05);
}
function punch() {
    if (shootCooldown > 0) return;
    shootCooldown = 0.4; punchAnimTime = 0.2; playHitSound(); 
    const playerPos = playerGroup.position;
    const playerDir = new THREE.Vector3(); camera.getWorldDirection(playerDir); playerDir.y = 0; playerDir.normalize();
    let hitSomething = false;
    const targets = [...npcs]; for (let id in otherPlayers) targets.push(otherPlayers[id]);
    targets.forEach(target => {
        if (hitSomething) return; 
        const targetPos = target.group.position;
        const distance = playerPos.distanceTo(targetPos);
        if (distance <= PUNCH_RANGE) {
            const dirToTarget = new THREE.Vector3().subVectors(targetPos, playerPos).normalize();
            if (playerDir.dot(dirToTarget) > 0.5) {
                hitSomething = true;
                let hitPlayerId = target.group.userData.playerId;
                if (hitPlayerId.startsWith("npc_")) {
                    let npcHit = npcs.find(n => n.group.userData.playerId === hitPlayerId);
                    if (npcHit) {
                        npcHit.group.userData.hp -= PUNCH_DAMAGE;
                        if (npcHit.group.userData.hp <= 0) {
                            npcHit.group.userData.hp = 0; npcHit.group.rotation.x = -Math.PI / 2;
                            setTimeout(() => { npcHit.group.userData.hp = 100; npcHit.group.rotation.x = 0; npcHit.group.position.set((Math.random() - 0.5) * 200, FEET_LEVEL, (Math.random() - 0.5) * 200); }, 3000);
                        }
                    }
                } else { socket.emit('shootPlayer', { targetId: hitPlayerId, isHeadshot: false, damage: PUNCH_DAMAGE }); }
                const hm = document.getElementById('hitmarker');
                if (hm) { hm.style.opacity = '1'; hm.style.color = 'red'; hm.innerText = "X"; setTimeout(() => { hm.style.opacity = '0'; }, 100); }
            }
        }
    });
}
function shoot() {
    if (shootCooldown > 0) return; 
    
    if (currentWeapon === 'pistol') { shootCooldown = 0.2; gunKickback = 0.15; }
    else if (currentWeapon === 'rifle') { shootCooldown = 0.15; gunKickback = 0.2; }
    else if (currentWeapon === 'sniper') { shootCooldown = 1.5; gunKickback = 0.6; } 
    else if (currentWeapon === 'bazooka') { shootCooldown = 2.5; gunKickback = 0.8; } 

    playShootSound(); 
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    raycaster.far = Infinity; 
    const allTargets = [...objects, ...playersMeshes];
    const intersects = raycaster.intersectObjects(allTargets, true);

    if (intersects.length > 0) {
        const hitObj = intersects[0].object; const hitPoint = intersects[0].point;
        
        let hitPlayerId = null; let obj = hitObj;
        while (obj) { if (obj.userData.playerId) { hitPlayerId = obj.userData.playerId; break; } obj = obj.parent; }
        let isHeadshot = hitObj.userData.isHead ? true : false;

        if (hitPlayerId) {
            let finalDamage = (currentWeapon === 'pistol') ? 25 : (currentWeapon === 'rifle') ? 35 : (currentWeapon === 'sniper') ? 100 : 150;

            if (hitPlayerId.startsWith("npc_")) {
                let npcHit = npcs.find(n => n.group.userData.playerId === hitPlayerId);
                if (npcHit) {
                    npcHit.group.userData.hp -= finalDamage;
                    if (npcHit.group.userData.hp <= 0) {
                        npcHit.group.userData.hp = 0; npcHit.group.rotation.x = -Math.PI / 2;
                        setTimeout(() => { npcHit.group.userData.hp = 100; npcHit.group.rotation.x = 0; npcHit.group.position.set((Math.random() - 0.5) * 200, FEET_LEVEL, (Math.random() - 0.5) * 200); }, 3000);
                    }
                }
            } else { socket.emit('shootPlayer', { targetId: hitPlayerId, isHeadshot: isHeadshot, damage: finalDamage }); }
            playHitSound();
            const hm = document.getElementById('hitmarker');
            if (hm) { hm.style.opacity = '1'; hm.style.color = isHeadshot ? 'yellow' : 'red'; hm.innerText = isHeadshot ? "☠" : "X"; setTimeout(() => { hm.style.opacity = '0'; }, 100); }
        }

        const sparkGeo = new THREE.BoxGeometry(1, 1, 1); 
        const sparkMat = new THREE.MeshBasicMaterial({ color: currentWeapon === 'bazooka' ? 0xff4400 : 0xffaa00 });
        const spark = new THREE.Mesh(sparkGeo, sparkMat); spark.position.copy(hitPoint); scene.add(spark);
        
        if (currentWeapon === 'bazooka') {
            spark.scale.set(5, 5, 5); 
            setTimeout(() => { scene.remove(spark); sparkGeo.dispose(); sparkMat.dispose(); }, 500);
        } else {
            setTimeout(() => { scene.remove(spark); sparkGeo.dispose(); sparkMat.dispose(); }, 200);
        }
    }
}
function onKeyDown(event) {
    if (isDead) return;
    if (event.code === 'Tab') { event.preventDefault(); isThirdPerson = !isThirdPerson; }
    if (event.code === 'Digit1') { isArmed = true; isMelee = false; }
    if (event.code === 'Digit2') { isArmed = false; isMelee = false; }
    if (event.code === 'Digit3') { isArmed = false; isMelee = true; } 
    if (event.code === 'Space' && isGrounded) { velocityY = JUMP_FORCE; isGrounded = false; }
    switch (event.code) {
        case 'ArrowUp': case 'KeyW': moveForward = true; break;
        case 'ArrowLeft': case 'KeyA': moveLeft = true; break;
        case 'ArrowDown': case 'KeyS': moveBackward = true; break;
        case 'ArrowRight': case 'KeyD': moveRight = true; break;
    }
}
function onKeyUp(event) {
    switch (event.code) {
        case 'ArrowUp': case 'KeyW': moveForward = false; break;
        case 'ArrowLeft': case 'KeyA': moveLeft = false; break;
        case 'ArrowDown': case 'KeyS': moveBackward = false; break;
        case 'ArrowRight': case 'KeyD': moveRight = false; break;
    }
}
function checkCollision(newX, newZ) {
    const playerRadius = 2; 
    for (let i = 0; i < objects.length; i++) {
        if(objects[i].geometry.type === 'PlaneGeometry') continue;
        const wallBox = new THREE.Box3().setFromObject(objects[i]);
        wallBox.expandByScalar(playerRadius);
        if (newX > wallBox.min.x && newX < wallBox.max.x && newZ > wallBox.min.z && newZ < wallBox.max.z) return true; 
    }
    return false; 
}
function updateHealthBarPosition(character, camera) {
    if (!character.healthBar || !character.group || !character.group.visible) {
        if(character.healthBar) character.healthBar.container.style.display = 'none';
        if(character.group && character.group.userData.nameElement) character.group.userData.nameElement.style.display = 'none';
        return;
    }
    const hp = character.group.userData.hp !== undefined ? character.group.userData.hp : 100;
    character.healthBar.container.style.display = 'block';
    character.healthBar.bar.style.width = `${hp}%`;
    if (hp > 50) character.healthBar.bar.style.backgroundColor = '#00ff00';
    else if (hp > 20) character.healthBar.bar.style.backgroundColor = '#ffff00';
    else character.healthBar.bar.style.backgroundColor = '#ff0000';

    const pos = character.group.position.clone();
    pos.y += 25; 
    pos.project(camera);
    if (pos.z > 1) {
        character.healthBar.container.style.display = 'none';
        if(character.group.userData.nameElement) character.group.userData.nameElement.style.display = 'none';
        return;
    }
    const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (pos.y * -0.5 + 0.5) * window.innerHeight;
    character.healthBar.container.style.left = x + 'px';
    character.healthBar.container.style.top = y + 'px';

    if (character.group.userData.nameElement) {
        character.group.userData.nameElement.style.display = 'block';
        const namePos = character.group.position.clone();
        namePos.y += 35;
        namePos.project(camera);
        if (namePos.z > 1) {
            character.group.userData.nameElement.style.display = 'none';
        } else {
            const nx = (namePos.x * 0.5 + 0.5) * window.innerWidth;
            const ny = (namePos.y * -0.5 + 0.5) * window.innerHeight;
            character.group.userData.nameElement.style.left = nx + 'px';
            character.group.userData.nameElement.style.top = ny + 'px';
        }
    }
}

function animate() {
    requestAnimationFrame(animate);
    const delta = 0.016;
    if (shootCooldown > 0) shootCooldown -= delta;
    if (punchAnimTime > 0) punchAnimTime -= delta; 

    npcs.forEach(npc => {
        if (npc.group.userData.hp > 0) {
            npc.group.position.x += npc.direction.x * 40 * delta;
            npc.group.position.z += npc.direction.z * 40 * delta;
            npc.group.position.y = FEET_LEVEL; 
            npc.group.rotation.y = Math.atan2(npc.direction.x, npc.direction.z);
            if (npc.group.position.length() > 150) { npc.direction.multiplyScalar(-1); npc.group.position.clampLength(0, 150); }
            npcs.forEach(otherNpc => {
                if (npc !== otherNpc && npc.group.position.distanceTo(otherNpc.group.position) < 20) {
                    const temp = npc.direction.x; npc.direction.x = -npc.direction.z; npc.direction.z = temp;
                }
            });
            npc.leftLeg.rotation.x = Math.sin(Date.now() * 0.01) * 0.8;
            npc.rightLeg.rotation.x = Math.sin(Date.now() * 0.01 + Math.PI) * 0.8;
        } else {
            npc.leftLeg.rotation.x = 0; npc.rightLeg.rotation.x = 0;
        }
    });

    if (controls.isLocked === true) {
        const speed = PLAYER_SPEED; 
        camera.getWorldDirection(forwardVector); forwardVector.y = 0; forwardVector.normalize();
        rightVector.crossVectors(camera.up, forwardVector).normalize();
        direction.set(0, 0, 0);
        if (!isDead) {
            if (moveForward) direction.add(forwardVector);
            if (moveBackward) direction.sub(forwardVector);
            if (moveRight) direction.add(rightVector);
            if (moveLeft) direction.sub(rightVector);
        }
        const isMoving = direction.length() > 0;
        if (isMoving) {
            direction.normalize();
            const oldX = controls.getObject().position.x; const oldZ = controls.getObject().position.z;
            controls.getObject().position.addScaledVector(direction, speed * delta);
            const newX = controls.getObject().position.x; const newZ = controls.getObject().position.z;
            if (checkCollision(newX, newZ)) { controls.getObject().position.x = oldX; controls.getObject().position.z = oldZ; }
            const distFromCenter = Math.sqrt(newX * newX + newZ * newZ);
            if (distFromCenter > MAP_BOUNDARY) { controls.getObject().position.x = oldX; controls.getObject().position.z = oldZ; }
        }
        const cameraPos = controls.getObject().position;
        velocityY -= GRAVITY * delta; cameraPos.y += velocityY * delta;
        if (cameraPos.y <= GROUND_LEVEL) { cameraPos.y = GROUND_LEVEL; velocityY = 0; isGrounded = true; }

        socket.emit('updatePosition', { x: cameraPos.x, y: cameraPos.y, z: cameraPos.z, rotationY: playerGroup.rotation.y, isArmed: isArmed });

        if (isMoving && isGrounded) { runTime += 0.25; } else { runTime = 0; }
        if (!isGrounded) {
            if (velocityY > 0) { leftLeg.rotation.x = -0.5; rightLeg.rotation.x = -0.5; leftArm.rotation.x = -2.5; rightArm.rotation.x = -2.5; } 
            else { leftLeg.rotation.x = 0.3; rightLeg.rotation.x = -0.3; leftArm.rotation.x = 0.5; rightArm.rotation.x = 0.5; }
        } else {
            leftLeg.rotation.x = Math.sin(runTime) * 0.8;
            rightLeg.rotation.x = Math.sin(runTime + Math.PI) * 0.8;
            if (punchAnimTime > 0) { rightArm.rotation.x = -2.0; rightArm.rotation.z = 0.5; leftArm.rotation.x = 0.5; } 
            else if (isArmed) { leftArm.rotation.x = -1.5; rightArm.rotation.x = -1.5; leftArm.rotation.z = 0; rightArm.rotation.z = 0; } 
            else { leftArm.rotation.x = Math.sin(runTime + Math.PI) * 0.5; rightArm.rotation.x = Math.sin(runTime) * 0.5; leftArm.rotation.z = 0; rightArm.rotation.z = 0; }
        }
        gun.visible = isArmed;
        if (gunKickback > 0) {
            gunKickback -= delta;
            if (isThirdPerson) {
                playerGroup.position.x -= forwardVector.x * gunKickback * 0.5;
                playerGroup.position.z -= forwardVector.z * gunKickback * 0.5;
            } else {
                window.fpsGun.position.z = -3 + (gunKickback * (currentWeapon === 'bazooka' ? 4 : currentWeapon === 'sniper' ? 3 : 2));
                window.fpsGun.rotation.x = gunKickback * (currentWeapon === 'bazooka' ? 3 : currentWeapon === 'sniper' ? 2 : 1.5);
            }
        }
        
        if (isThirdPerson) {
            playerGroup.visible = true; window.fpsGun.visible = isArmed; 
            const cameraDirection = new THREE.Vector3(); camera.getWorldDirection(cameraDirection);
            const angle = Math.atan2(cameraDirection.x, cameraDirection.z); playerGroup.rotation.y = angle; 
            playerGroup.position.x = cameraPos.x + forwardVector.x * 60;
            playerGroup.position.z = cameraPos.z + forwardVector.z * 60;
            playerGroup.position.y = FEET_LEVEL; 
            head.visible = true; head.rotation.x = isArmed ? 0 : 0.2;
        } else {
            playerGroup.visible = false; window.fpsGun.visible = isArmed; 
        }
        
        updateHealthBarPosition(playerGroup, camera);
        for (let id in otherPlayers) updateHealthBarPosition(otherPlayers[id], camera);
        npcs.forEach(npc => updateHealthBarPosition(npc, camera));
    }
    renderer.render(scene, camera);
}

window.mobileShoot = function() { if (!isDead && controls.isLocked) { if (isMelee) punch(); else if (isArmed) shoot(); } };
window.mobileJump = function() { if (isGrounded && !isDead) { velocityY = JUMP_FORCE; isGrounded = false; } };
window.mobileSwitch = function() { if (isArmed) { isArmed = false; isMelee = true; } else if (isMelee) { isArmed = false; isMelee = false; } else { isArmed = true; isMelee = false; } };

function updateWeaponUI() {
    const wpName = document.getElementById('weapon-name');
    const ammo = document.getElementById('ammo-display');
    if(!wpName || !ammo) return;
    if (isMelee) { wpName.innerText = "TAY KHÔNG"; ammo.innerText = "∞"; } 
    else if (isArmed) { 
        if (currentWeapon === 'pistol') wpName.innerText = "SÚNG LỤC";
        else if (currentWeapon === 'rifle') wpName.innerText = "SÚNG TRƯỜNG";
        else if (currentWeapon === 'sniper') wpName.innerText = "SÚNG TỈA";
        else if (currentWeapon === 'bazooka') wpName.innerText = "BAZOOKA";
        ammo.innerText = "∞"; 
    } 
    else { wpName.innerText = "KHÔNG VŨ KHÍ"; ammo.innerText = "-"; }
}
setInterval(updateWeaponUI, 100);
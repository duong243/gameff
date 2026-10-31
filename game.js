import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const socket = io();
const urlParams = new URLSearchParams(window.location.search);
let gameMode = urlParams.get('mode') || 'map1'; 
const roomId = urlParams.get('room') || 'public'; 

// LẤY DỮ LIỆU NGƯỜI CHƠI
const currentWeapon = localStorage.getItem('userCurrentWeapon') || 'pistol'; 
const weaponLevels = JSON.parse(localStorage.getItem('userWeaponLevels')) || { pistol: 1, rifle: 1, sniper: 1, bazooka: 1 };
const myName = localStorage.getItem('loggedInUser') || "Khách";
const isMyAdmin = localStorage.getItem('userIsAdmin') === 'true';

// BIẾN TOÀN CỤC
let camera, scene, renderer, controls;
let objects = []; let playersMeshes = []; let npcs = [];
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let playerGroup; let isThirdPerson = true; let isArmed = true; let isDead = false;
let myKills = 0, myHeadshots = 0, myScore = 0;
let isMelee = false; let punchAnimTime = 0; const PUNCH_DAMAGE = 15; const PUNCH_RANGE = 25;
let forwardVector = new THREE.Vector3(); let rightVector = new THREE.Vector3(); let direction = new THREE.Vector3();
let velocityY = 0; let isGrounded = false; const GRAVITY = 80; const JUMP_FORCE = 35; 
const GROUND_LEVEL = 65; const FEET_LEVEL = 25; const MAP_BOUNDARY = 700;
let raycaster = new THREE.Raycaster(); let shootCooldown = 0; let audioCtx; let gunKickback = 0;
let otherPlayers = {}; const MOUSE_SENSITIVITY = 1.0; const PLAYER_SPEED = 160;

// BIẾN CHẾ ĐỘ SINH TỒN
let currentMapLevel = 1;
let currentMonsterKills = 0;
const MONSTERS_PER_MAP = 5;

// BIẾN CHAT & KÉO THẢ
let chatBox = document.getElementById('chat-container');
let isDragging = false; let dragOffsetX = 0; let dragOffsetY = 0;

document.addEventListener('contextmenu', event => event.preventDefault());

init();
animate();

function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1.5);
    light.position.set(0, 200, 0); scene.add(light);

    if (gameMode === 'campaign') {
        buildCampaignMap();
    } else {
        buildMultiplayerMap();
    }

    const myChar = createCharacter(0x0000ff, myName, isMyAdmin);
    playerGroup = myChar.group;
    scene.add(playerGroup);
    playerGroup.userData.playerId = socket.id; 
    playerGroup.userData.hp = 100;

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
    
    // KHỞI TẠO KÉO THẢ CHAT
    const chatHeader = document.getElementById('chat-header');
    if (chatHeader) {
        chatHeader.addEventListener('mousedown', startDrag);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', stopDrag);
    }

    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(1); renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    if (gameMode === 'campaign') {
        startCampaignLevel(1);
    } else {
        socket.on('connect', () => {
            if (myName) socket.emit('setPlayerName', myName);
            socket.emit('joinRoom', { roomId: roomId, mode: gameMode });
        });
        socket.on('chatMessage', (data) => { addChatMessage(data.sender, data.message); });
        // Các sự kiện socket khác (newPlayer, playerMoved...) giữ nguyên
    }
}

// ==========================================
// CHẾ ĐỘ SINH TỒN (CAMPAIGN)
// ==========================================
function buildCampaignMap() {
    for (let i = scene.children.length - 1; i >= 0; i--) {
        let obj = scene.children[i];
        if (obj.type !== 'PerspectiveCamera' && obj.type !== 'HemisphereLight' && obj !== playerGroup) scene.remove(obj);
    }
    objects = []; npcs = [];
    scene.background = new THREE.Color(0x2c3e50);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshLambertMaterial({ color: 0x444444 }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    for (let i = 0; i < 20; i++) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(40, 40, 40), new THREE.MeshLambertMaterial({ color: 0x555555 }));
        wall.position.set((Math.random() - 0.5) * 800, 20, (Math.random() - 0.5) * 800);
        scene.add(wall); objects.push(wall);
    }
}

function startCampaignLevel(level) {
    currentMapLevel = level;
    currentMonsterKills = 0;
    addChatMessage("Hệ thống", `Bắt đầu Map ${level}. Tiêu diệt ${MONSTERS_PER_MAP} quái vật!`);
    npcs.forEach(npc => scene.remove(npc.group));
    npcs = [];
    for (let i = 0; i < MONSTERS_PER_MAP; i++) createMonster(level);
}

function createMonster(level) {
    const isBoss = level % 5 === 0;
    const monsterColor = isBoss ? 0xff0000 : 0x00ff00;
    const monsterChar = createCharacter(monsterColor, isBoss ? "BOSS" : `Quái Map ${level}`, false);
    monsterChar.group.position.set((Math.random() - 0.5) * 200, FEET_LEVEL, (Math.random() - 0.5) * 200);
    monsterChar.group.userData.playerId = "npc_" + Math.random();
    monsterChar.group.userData.isNPC = true;
    monsterChar.group.userData.hp = (isBoss ? 200 : 50) + level * 20;
    monsterChar.group.userData.maxHp = monsterChar.group.userData.hp;
    monsterChar.group.userData.isBoss = isBoss;
    monsterChar.group.userData.level = level;
    monsterChar.healthBar = createHealthBar();
    scene.add(monsterChar.group); playersMeshes.push(monsterChar.group); npcs.push(monsterChar);
}

// ==========================================
// MULTIPLAYER MAP
// ==========================================
function buildMultiplayerMap() {
    let floorColor = 0x55aa55;
    scene.background = new THREE.Color(0x87CEEB);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshLambertMaterial({ color: floorColor }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    for (let i = 0; i < 100; i++) {
        const tree = new THREE.Mesh(new THREE.CylinderGeometry(2, 3, 30, 6), new THREE.MeshLambertMaterial({ color: 0x8B4513 }));
        tree.position.set((Math.random()-0.5)*1000, 15, (Math.random()-0.5)*1000); scene.add(tree); objects.push(tree);
    }
}

// ==========================================
// HÀM SHOOT
// ==========================================
function shoot() {
    if (shootCooldown > 0) return; 
    shootCooldown = 0.15; playShootSound(); gunKickback = 0.15; 

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
            let finalDamage = 25;
            if (currentWeapon === 'rifle') finalDamage = 35;
            if (currentWeapon === 'sniper') finalDamage = 100;
            if (currentWeapon === 'bazooka') finalDamage = 150;

            if (hitPlayerId.startsWith("npc_")) {
                let npcHit = npcs.find(n => n.group.userData.playerId === hitPlayerId);
                if (npcHit) {
                    npcHit.group.userData.hp -= finalDamage;
                    if (npcHit.group.userData.hp <= 0) {
                        // QUÁI CHẾT
                        scene.remove(npcHit.group);
                        const index = npcs.indexOf(npcHit);
                        if (index > -1) { npcs.splice(index, 1); playersMeshes = playersMeshes.filter(m => m !== npcHit.group); }
                        
                        currentMonsterKills++;
                        const expGain = npcHit.group.userData.level * 10;
                        const goldGain = npcHit.group.userData.level * 5;
                        const diamondGain = npcHit.group.userData.isBoss ? npcHit.group.userData.level * 2 : 0;
                        
                        addChatMessage("Hệ thống", `Hạ gục quái! +${expGain} EXP, +${goldGain} Vàng ${diamondGain > 0 ? '+'+diamondGain+' Kim Cương' : ''}`);
                        
                        if (currentMonsterKills >= MONSTERS_PER_MAP) {
                            addChatMessage("Hệ thống", `Hoàn thành Map ${currentMapLevel}! Chuẩn bị sang Map tiếp theo...`);
                            setTimeout(() => { startCampaignLevel(currentMapLevel + 1); }, 3000);
                        }
                    }
                }
            } else {
                socket.emit('shootPlayer', { targetId: hitPlayerId, isHeadshot: isHeadshot, damage: finalDamage });
            }
            playHitSound();
            const hm = document.getElementById('hitmarker');
            if (hm) { hm.style.opacity = '1'; hm.style.color = isHeadshot ? 'yellow' : 'red'; hm.innerText = isHeadshot ? "☠" : "X"; setTimeout(() => { hm.style.opacity = '0'; }, 100); }
        }
        const sparkGeo = new THREE.BoxGeometry(1, 1, 1); const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
        const spark = new THREE.Mesh(sparkGeo, sparkMat); spark.position.copy(hitPoint); scene.add(spark);
        setTimeout(() => { scene.remove(spark); sparkGeo.dispose(); sparkMat.dispose(); }, 200);
    }
}

// ==========================================
// CHAT & KÉO THẢ
// ==========================================
function toggleChat() { if (chatBox) chatBox.classList.toggle('chat-hidden'); }

function addChatMessage(sender, message) {
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;
    const msgDiv = document.createElement('div');
    msgDiv.innerHTML = `<span class="chat-sender">${sender}:</span> ${message}`;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendChatMessage() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const msg = input.value.trim();
    if (msg === "") return;
    if (gameMode === 'campaign') {
        addChatMessage(myName, msg);
    } else {
        socket.emit('chatMessage', { sender: myName, message: msg });
    }
    input.value = "";
}

function handleChatKeyPress(event) {
    if (event.key === 'Enter') sendChatMessage();
}

function startDrag(e) {
    if (!chatBox) return;
    isDragging = true;
    dragOffsetX = e.clientX - chatBox.offsetLeft;
    dragOffsetY = e.clientY - chatBox.offsetTop;
    chatBox.style.transition = 'none';
}

function drag(e) {
    if (!isDragging || !chatBox) return;
    chatBox.style.left = (e.clientX - dragOffsetX) + 'px';
    chatBox.style.top = (e.clientY - dragOffsetY) + 'px';
    chatBox.style.bottom = 'auto';
}

function stopDrag() { isDragging = false; }

// ==========================================
// CÁC HÀM CƠ BẢN KHÁC
// ==========================================
function createCharacter(color, name = "", isAdmin = false) {
    const group = new THREE.Group();
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xffcc99 });
    const shirtMat = new THREE.MeshLambertMaterial({ color: color }); 
    const pantsMat = new THREE.MeshLambertMaterial({ color: 0x333333 });

    const head = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 8), skinMat);
    head.position.set(0, 13, 0); head.userData.isHead = true; group.add(head);
    const body = new THREE.Mesh(new THREE.BoxGeometry(8, 12, 4), shirtMat); body.position.y = 3; group.add(body);
    
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(3.5, 10, 3.5), shirtMat); leftArm.position.set(-5.5, 5, 0); group.add(leftArm);
    const rightArm = new THREE.Mesh(new THREE.BoxGeometry(3.5, 10, 3.5), shirtMat); rightArm.position.set(5.5, 5, 0); group.add(rightArm);
    const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(3.5, 10, 3.5), pantsMat); leftLeg.position.set(-2.2, -7, 0); group.add(leftLeg);
    const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(3.5, 10, 3.5), pantsMat); rightLeg.position.set(2.2, -7, 0); group.add(rightLeg);

    let gunMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
    let gun = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 6), gunMat);
    gun.position.set(0, -4, 2); rightArm.add(gun);

    const nameDiv = document.createElement('div');
    nameDiv.style.position = 'absolute';
    nameDiv.style.color = isAdmin ? '#ff3333' : '#00ff00';
    nameDiv.style.fontWeight = 'bold';
    nameDiv.style.fontSize = '18px';
    nameDiv.style.textShadow = '2px 2px 2px black';
    nameDiv.style.pointerEvents = 'none';
    nameDiv.style.transform = 'translate(-50%, -50%)';
    nameDiv.style.zIndex = '99';
    nameDiv.style.display = 'none';
    nameDiv.innerText = name;
    document.body.appendChild(nameDiv);
    group.userData.nameElement = nameDiv;

    return { group, leftArm, rightArm, leftLeg, rightLeg, head, gun };
}

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
                            scene.remove(npcHit.group);
                            const index = npcs.indexOf(npcHit);
                            if (index > -1) { npcs.splice(index, 1); playersMeshes = playersMeshes.filter(m => m !== npcHit.group); }
                            currentMonsterKills++;
                            addChatMessage("Hệ thống", `Hạ gục quái bằng tay!`);
                            if (currentMonsterKills >= MONSTERS_PER_MAP) {
                                setTimeout(() => { startCampaignLevel(currentMapLevel + 1); }, 3000);
                            }
                        }
                    }
                } else { socket.emit('shootPlayer', { targetId: hitPlayerId, isHeadshot: false, damage: PUNCH_DAMAGE }); }
                const hm = document.getElementById('hitmarker');
                if (hm) { hm.style.opacity = '1'; hm.style.color = 'red'; hm.innerText = "X"; setTimeout(() => { hm.style.opacity = '0'; }, 100); }
            }
        }
    });
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
            npc.group.rotation.y = Math.atan2(playerGroup.position.x - npc.group.position.x, playerGroup.position.z - npc.group.position.z);
            // Có thể thêm di chuyển quái về phía người chơi ở đây
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

        if (gameMode !== 'campaign') {
            socket.emit('updatePosition', { x: cameraPos.x, y: cameraPos.y, z: cameraPos.z, rotationY: playerGroup.rotation.y, isArmed: isArmed });
        }

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
/* Crossroads 2007 - live web preview (renders assets/map.json with three.js) */
(function () {
  "use strict";

  var canvas = document.getElementById("view");
  var overlay = document.getElementById("view-overlay");
  var mapUrl = canvas.getAttribute("data-map") || "assets/map.json";

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7ec0f7); // classic blue afternoon sky

  var camera = new THREE.PerspectiveCamera(70, 2, 0.1, 3000);

  /* ---------------- classic sky: sun disc + puffy clouds ---------------- */
  function makeCloudTexture() {
    var c = document.createElement("canvas");
    c.width = c.height = 128;
    var g = c.getContext("2d");
    var blobs = [[38, 74, 30], [66, 62, 36], [94, 74, 30], [66, 84, 26], [48, 58, 22], [84, 56, 22]];
    for (var i = 0; i < blobs.length; i++) {
      var b = blobs[i];
      var grad = g.createRadialGradient(b[0], b[1], 4, b[0], b[1], b[2]);
      grad.addColorStop(0, "rgba(255,255,255,0.95)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
    }
    var tex = new THREE.CanvasTexture(c);
    return tex;
  }
  var cloudTex = makeCloudTexture();
  for (var ci = 0; ci < 16; ci++) {
    var smat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false });
    var sp = new THREE.Sprite(smat);
    var ang = (ci / 16) * Math.PI * 2 + (ci % 3);
    var rad = 380 + (ci % 5) * 120;
    sp.position.set(Math.cos(ang) * rad, 130 + (ci % 4) * 45, Math.sin(ang) * rad);
    sp.scale.set(160 + (ci % 3) * 70, 70 + (ci % 3) * 25, 1);
    scene.add(sp);
  }
  var sunC = document.createElement("canvas");
  sunC.width = sunC.height = 128;
  var sunG = sunC.getContext("2d");
  var sunGrad = sunG.createRadialGradient(64, 64, 8, 64, 64, 64);
  sunGrad.addColorStop(0, "rgba(255,255,230,1)");
  sunGrad.addColorStop(0.35, "rgba(255,240,150,0.9)");
  sunGrad.addColorStop(1, "rgba(255,240,150,0)");
  sunG.fillStyle = sunGrad;
  sunG.fillRect(0, 0, 128, 128);
  var sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(sunC), transparent: true, depthWrite: false }));
  sun.position.set(500, 420, -300);
  sun.scale.set(220, 220, 1);
  scene.add(sun);

  /* ---------------- lighting: flat legacy look, no shadows ---------------- */
  scene.add(new THREE.AmbientLight(0xffffff, 0.72));
  var dirLight = new THREE.DirectionalLight(0xffffff, 0.55);
  dirLight.position.set(300, 400, -200);
  scene.add(dirLight);

  /* ---------------- classic stud + face textures ---------------- */
  var texCache = {};
  function studTexture(hex) {
    var key = "stud:" + hex;
    if (texCache[key]) return texCache[key];
    var c = document.createElement("canvas");
    c.width = c.height = 64;
    var g = c.getContext("2d");
    g.fillStyle = hex;
    g.fillRect(0, 0, 64, 64);
    // stud cylinder top: darker rim, lighter center, soft highlight
    var rim = g.createRadialGradient(32, 32, 8, 32, 32, 26);
    rim.addColorStop(0, "rgba(255,255,255,0.30)");
    rim.addColorStop(0.55, "rgba(0,0,0,0.02)");
    rim.addColorStop(0.8, "rgba(0,0,0,0.20)");
    rim.addColorStop(1, "rgba(0,0,0,0.0)");
    g.fillStyle = rim;
    g.beginPath();
    g.arc(32, 32, 24, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(0,0,0,0.16)";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(32, 32, 24, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.beginPath();
    g.ellipse(26, 24, 8, 6, -0.6, 0, Math.PI * 2);
    g.fill();
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    texCache[key] = tex;
    return tex;
  }

  function spawnTexture() {
    var key = "spawn";
    if (texCache[key]) return texCache[key];
    var c = document.createElement("canvas");
    c.width = c.height = 128;
    var g = c.getContext("2d");
    g.fillStyle = "#F2F3F3";
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = "#D6202C";
    g.beginPath();
    g.arc(64, 64, 16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#1C7FD0";
    g.beginPath();
    g.arc(64, 64, 7, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#9AA0A5";
    g.lineWidth = 5;
    g.beginPath();
    g.arc(64, 64, 34, 0.4, 2.2);
    g.stroke();
    g.beginPath();
    g.arc(64, 64, 34, Math.PI + 0.4, Math.PI + 2.2);
    g.stroke();
    texCache[key] = new THREE.CanvasTexture(c);
    return texCache[key];
  }

  function logoTexture() {
    var key = "logo";
    if (texCache[key]) return texCache[key];
    var c = document.createElement("canvas");
    c.width = c.height = 256;
    var g = c.getContext("2d");
    g.fillStyle = "#F2F3F3";
    g.fillRect(0, 0, 256, 256);
    g.translate(128, 118);
    g.rotate(-0.06);
    g.font = "italic 900 64px Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 10;
    g.lineJoin = "round";
    g.strokeStyle = "#1F2A35";
    g.strokeText("ROBLOX", 0, -20);
    g.fillStyle = "#DA291C";
    g.fillText("ROBLOX", 0, -20);
    g.font = "bold 30px Arial, sans-serif";
    g.lineWidth = 6;
    g.strokeStyle = "#1F2A35";
    g.strokeText("POWERING IMAGINATION", 0, 44);
    g.fillStyle = "#FFFFFF";
    g.fillText("POWERING IMAGINATION", 0, 44);
    texCache[key] = new THREE.CanvasTexture(c);
    return texCache[key];
  }

  function signTexture(bgHex, lines) {
    var key = "sign:" + bgHex + JSON.stringify(lines);
    if (texCache[key]) return texCache[key];
    var c = document.createElement("canvas");
    c.width = 512;
    c.height = 256;
    var g = c.getContext("2d");
    g.fillStyle = bgHex;
    g.fillRect(0, 0, 512, 256);
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      var cy = (L.pos[1] + L.size[1] / 2) * 256;
      var fontPx = Math.min(L.size[1] * 256 * 0.62, 90);
      g.font = "bold " + Math.round(fontPx) + "px Arial, sans-serif";
      g.fillStyle = L.color;
      g.fillText(L.text, 256, cy, 500);
    }
    texCache[key] = new THREE.CanvasTexture(c);
    return texCache[key];
  }

  function faceTexture() {
    var key = "face";
    if (texCache[key]) return texCache[key];
    var c = document.createElement("canvas");
    c.width = c.height = 128;
    var g = c.getContext("2d");
    g.fillStyle = "#F5CD30";
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = "#1B2A35";
    g.beginPath();
    g.arc(42, 48, 8, 0, Math.PI * 2);
    g.arc(86, 48, 8, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#1B2A35";
    g.lineWidth = 7;
    g.lineCap = "round";
    g.beginPath();
    g.arc(64, 66, 26, 0.35, Math.PI - 0.35);
    g.stroke();
    texCache[key] = new THREE.CanvasTexture(c);
    return texCache[key];
  }

  /* ---------------- geometry builders ---------------- */
  var unitBox = new THREE.BoxGeometry(1, 1, 1);
  var unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
  unitCyl.rotateZ(Math.PI / 2); // Roblox cylinders run along local X
  var unitBall = new THREE.SphereGeometry(0.5, 18, 12);

  function wedgeGeometry() {
    // wedge filling [-0.5,0.5]^3, tall face at -Z, slope descending toward +Z
    var g = new THREE.BufferGeometry();
    var v = new Float32Array([
      // back face (tall, at +Z=0.5? we put tall face at -Z)
      -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
      -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
      // bottom face
      -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, -0.5,
      -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5,
      // slope
      -0.5, -0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
      -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, -0.5,
      // left side triangle
      -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, -0.5, -0.5,
      // right side triangle
      0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
    ]);
    g.setAttribute("position", new THREE.BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  }
  var unitWedge = wedgeGeometry();

  function scaleTopUV(geom, sx, sz) {
    var uv = geom.attributes.uv;
    if (!uv) return geom;
    // BoxGeometry face vertex order: +x,-x,+y,-y,+z,-z (4 verts each); +y = 8..11
    for (var i = 8; i < 12; i++) {
      uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sz);
    }
    uv.needsUpdate = true;
    return geom;
  }

  // BoxGeometry group face index for a Roblox NormalId name
  var FACE_GROUP = { Right: 0, Left: 1, Top: 2, Bottom: 3, Back: 4, Front: 5 };

  function buildPrim(pr) {
    if (pr.k === "spawn") {
      var gm = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
      var mats = [new THREE.MeshLambertMaterial({ color: 0xffffff }),
                  new THREE.MeshLambertMaterial({ map: spawnTexture() }),
                  new THREE.MeshLambertMaterial({ color: 0xffffff })];
      var mesh = new THREE.Mesh(gm, mats);
      mesh.scale.set(pr.s[0], pr.s[1], pr.s[2]);
      mesh.position.set(pr.p[0], pr.p[1], pr.p[2]);
      return mesh;
    }

    var color = new THREE.Color(pr.c);
    if (pr.slate) color.multiplyScalar(0.92);
    var opacity = pr.tr ? 1 - pr.tr : 1;
    var baseMat = new THREE.MeshLambertMaterial({
      color: color,
      transparent: opacity < 1,
      opacity: opacity,
    });

    var geom, mesh;
    if (pr.k === "box") {
      geom = unitBox.clone();
      var mats = [baseMat, baseMat, baseMat, baseMat, baseMat, baseMat];
      if (pr.studs) {
        scaleTopUV(geom, pr.s[0], pr.s[2]);
        mats[2] = new THREE.MeshLambertMaterial({ map: studTexture(pr.c) });
      }
      if (pr.sign) {
        var gi = FACE_GROUP[pr.signFace || "Front"];
        mats[gi] = new THREE.MeshLambertMaterial({ color: 0xffffff, map: signTexture(pr.c, pr.sign) });
      }
      if (pr.logo) {
        var lm = new THREE.MeshLambertMaterial({ map: logoTexture() });
        mats[4] = lm; // back +Z
        mats[5] = lm; // front -Z
      }
      mesh = new THREE.Mesh(geom, mats);
    } else if (pr.k === "cyl") {
      geom = unitCyl;
      mesh = new THREE.Mesh(geom, baseMat);
    } else if (pr.k === "ball") {
      geom = unitBall;
      mesh = new THREE.Mesh(geom, baseMat);
    } else if (pr.k === "wedge") {
      geom = unitWedge;
      mesh = new THREE.Mesh(geom, baseMat);
    }

    if (pr.m) {
      var M = new THREE.Matrix4();
      M.set(
        pr.m[0], pr.m[1], pr.m[2], pr.p[0],
        pr.m[3], pr.m[4], pr.m[5], pr.p[1],
        pr.m[6], pr.m[7], pr.m[8], pr.p[2],
        0, 0, 0, 1
      );
      M.multiply(new THREE.Matrix4().makeScale(pr.s[0], pr.s[1], pr.s[2]));
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(M);
    } else {
      mesh.position.set(pr.p[0], pr.p[1], pr.p[2]);
      mesh.scale.set(pr.s[0], pr.s[1], pr.s[2]);
    }
    return mesh;
  }

  /* ---------------- classic noob at spawn ---------------- */
  function buildNoob(x, z) {
    var grp = new THREE.Group();
    var yellow = new THREE.MeshLambertMaterial({ color: 0xF5CD30 });
    var blue = new THREE.MeshLambertMaterial({ color: 0x0D69AC });
    var green = new THREE.MeshLambertMaterial({ color: 0x4B974B });
    var mk = function (mat, sx, sy, sz, px, py, pz) {
      var m = new THREE.Mesh(unitBox, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(px, py, pz);
      grp.add(m);
      return m;
    };
    mk(green, 1, 2, 1, -0.5, 1, 0);   // left leg
    mk(green, 1, 2, 1, 0.5, 1, 0);    // right leg
    mk(blue, 2, 2, 1, 0, 3, 0);       // torso
    mk(yellow, 1, 2, 1, -1.5, 3, 0);  // left arm
    mk(yellow, 1, 2, 1, 1.5, 3, 0);   // right arm
    // head with classic smile
    var headMats = [yellow, yellow, yellow, yellow, yellow, new THREE.MeshLambertMaterial({ map: faceTexture() })];
    var head = new THREE.Mesh(unitBox, headMats);
    head.scale.set(1.4, 1.4, 1.4);
    head.position.set(0, 4.75, 0);
    grp.add(head);
    grp.position.set(x, 0, z);
    grp.rotation.y = -0.4;
    scene.add(grp);
  }

  /* ---------------- load map ---------------- */
  var MAP = null;
  var started = false;

  fetch(mapUrl)
    .then(function (r) { return r.json(); })
    .then(function (map) {
      MAP = map;
      for (var i = 0; i < map.prims.length; i++) {
        scene.add(buildPrim(map.prims[i]));
      }
      buildNoob(4, 8);
      startLoop();
    })
    .catch(function (e) {
      overlay.innerHTML = '<div class="overlay-card"><h2>Could not load map.json</h2><p>' + e + "</p></div>";
    });

  /* ---------------- controls: pointer-lock walk, classic speeds ---------------- */
  var pos = { x: 6, y: 4.6, z: 22 };
  var vel = { x: 0, y: 0, z: 0 };
  var yaw = 0.08, pitch = -0.06;
  var keys = {};
  var grounded = true;
  var camLock = false;

  // screenshot / deep-link camera: ?cam=px,py,pz,tx,ty,tz
  var params = new URLSearchParams(location.search);
  if (params.get("cam")) {
    var a = params.get("cam").split(",").map(Number);
    if (a.length === 6 && a.every(isFinite)) {
      camLock = true;
      camera.position.set(a[0], a[1], a[2]);
      camera.lookAt(a[3], a[4], a[5]);
      overlay.style.display = "none";
    }
  }

  function onResize() {
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  overlay.addEventListener("click", function () {
    if (camLock) return;
    canvas.requestPointerLock && canvas.requestPointerLock();
  });
  document.addEventListener("pointerlockchange", function () {
    var locked = document.pointerLockElement === canvas;
    overlay.style.display = locked ? "none" : "flex";
    overlay.querySelector(".overlay-hint").textContent = "Click to explore (pointer lock)";
  });
  document.addEventListener("keydown", function (e) {
    if (e.code === "Escape") overlay.style.display = "flex";
  });
  document.addEventListener("mousemove", function (e) {
    if (document.pointerLockElement !== canvas && !dragging) return;
    yaw -= (e.movementX || 0) * 0.0026;
    pitch -= (e.movementY || 0) * 0.0026;
    pitch = Math.max(-1.45, Math.min(1.45, pitch));
  });
  // drag fallback (no pointer lock, e.g. headless)
  var dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener("mousedown", function (e) { dragging = true; lastX = e.clientX; lastY = e.clientY; });
  document.addEventListener("mouseup", function () { dragging = false; });
  canvas.addEventListener("mousemove", function (e) {
    if (!dragging || document.pointerLockElement === canvas) return;
    yaw -= (e.clientX - lastX) * 0.005;
    pitch -= (e.clientY - lastY) * 0.005;
    pitch = Math.max(-1.45, Math.min(1.45, pitch));
    lastX = e.clientX; lastY = e.clientY;
  });
  document.addEventListener("keydown", function (e) { keys[e.code] = true; });
  document.addEventListener("keyup", function (e) { keys[e.code] = false; });

  var last = 0;
  function step(t) {
    var dt = Math.min((t - last) / 1000, 0.05);
    last = t;
    if (camLock) return;

    var speed = keys.ShiftLeft ? 32 : 16; // classic walkspeed 16
    var fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    var rx = Math.cos(yaw), rz = -Math.sin(yaw);
    var mx = 0, mz = 0;
    if (keys.KeyW || keys.ArrowUp) { mx += fx; mz += fz; }
    if (keys.KeyS || keys.ArrowDown) { mx -= fx; mz -= fz; }
    if (keys.KeyD || keys.ArrowRight) { mx += rx; mz += rz; }
    if (keys.KeyA || keys.ArrowLeft) { mx -= rx; mz -= rz; }
    var ml = Math.hypot(mx, mz);
    if (ml > 0) { mx /= ml; mz /= ml; }
    vel.x = mx * speed;
    vel.z = mz * speed;

    if ((keys.Space) && grounded) { vel.y = 24; grounded = false; }
    vel.y -= 64 * dt; // ~ classic gravity feel
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;
    var floor = 4.6;
    if (pos.y <= floor) { pos.y = floor; vel.y = 0; grounded = true; }
    pos.x = Math.max(-250, Math.min(250, pos.x));
    pos.z = Math.max(-250, Math.min(250, pos.z));

    camera.position.set(pos.x, pos.y, pos.z);
    camera.rotation.set(0, 0, 0);
    camera.rotateY(yaw);
    camera.rotateX(pitch);
  }

  function startLoop() {
    if (started) return;
    started = true;
    overlay.querySelector(".overlay-hint").textContent = "Click to explore (pointer lock)";
    var loop = function (t) {
      onResize();
      step(t);
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
})();

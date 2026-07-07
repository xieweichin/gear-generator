const svg = document.querySelector("#gearSvg");
const controls = {
  gearType: document.querySelector("#gearType"),
  gearCount: document.querySelector("#gearCount"),
  teeth: document.querySelector("#teeth"),
  teeth2: document.querySelector("#teeth2"),
  module: document.querySelector("#module"),
  pressureAngle: document.querySelector("#pressureAngle"),
  bore: document.querySelector("#bore"),
  bore2: document.querySelector("#bore2"),
  shift: document.querySelector("#shift"),
  showGuides: document.querySelector("#showGuides"),
  animatePreview: document.querySelector("#animatePreview"),
  downloadTarget: document.querySelector("#downloadTarget")
};

const readouts = {
  pitchDiameter: document.querySelector("#pitchDiameter"),
  outerDiameter: document.querySelector("#outerDiameter"),
  rootDiameter: document.querySelector("#rootDiameter"),
  baseDiameter: document.querySelector("#baseDiameter"),
  circularPitch: document.querySelector("#circularPitch"),
  centerDistance: document.querySelector("#centerDistance"),
  pitchLabel: document.querySelector("#pitchLabel"),
  outerLabel: document.querySelector("#outerLabel"),
  rootLabel: document.querySelector("#rootLabel"),
  distanceLabel: document.querySelector("#distanceLabel"),
  gearName: document.querySelector("#gearName"),
  statusText: document.querySelector("#statusText"),
  boreField: document.querySelector("#boreField"),
  bore2Field: document.querySelector("#bore2Field"),
  teeth2Field: document.querySelector("#teeth2Field")
};

let current = null;
let animationFrame = null;
let animationStart = 0;
const storageKey = "badetechGearGeneratorSettings";
const settingsVersion = 3;
const previewAnimationSpeed = 0.1;
const backlashFactor = 0.08;
const meshClearanceFactor = 0.08;

const typeNames = {
  external: "外齒輪",
  rack: "齒條",
  internal: "內齒輪"
};

function mm(value) {
  return `${value.toFixed(2)} mm`;
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (Number.isNaN(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function getParams() {
  return {
    gearType: controls.gearType.value,
    gearCount: Number(controls.gearCount.value),
    teeth: Math.round(clampNumber(controls.teeth.value, 6, 160)),
    teeth2: Math.round(clampNumber(controls.teeth2.value, 6, 160)),
    module: clampNumber(controls.module.value, 0.2, 12),
    pressureAngle: clampNumber(controls.pressureAngle.value, 10, 35) * Math.PI / 180,
    bore: clampNumber(controls.bore.value, 0, 200),
    bore2: clampNumber(controls.bore2.value, 0, 200),
    shift: clampNumber(controls.shift.value, -0.8, 0.8),
    showGuides: controls.showGuides.checked,
    animatePreview: controls.animatePreview.checked,
    animationSpeed: previewAnimationSpeed,
    downloadTarget: controls.downloadTarget.value
  };
}

function loadSavedSettings() {
  if (typeof localStorage === "undefined") return;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    if (saved.settingsVersion !== settingsVersion) {
      saved.gearCount = 2;
      saved.bore = 3;
      saved.bore2 = 3;
      saved.settingsVersion = settingsVersion;
    }
    for (const [key, value] of Object.entries(saved)) {
      const control = controls[key];
      if (!control) continue;
      if (control.type === "checkbox") control.checked = Boolean(value);
      else control.value = String(value);
    }
  } catch {
    localStorage.removeItem(storageKey);
  }
}

function saveSettings(params) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      settingsVersion,
      gearType: params.gearType,
      gearCount: params.gearCount,
      teeth: params.teeth,
      teeth2: params.teeth2,
      module: params.module,
      pressureAngle: controls.pressureAngle.value,
      bore: params.bore,
      bore2: params.bore2,
      shift: params.shift,
      showGuides: params.showGuides,
      animatePreview: params.animatePreview,
      downloadTarget: params.downloadTarget
    }));
  } catch {
    // The tool still works if private browsing or local policy blocks storage.
  }
}

function polar(radius, angle) {
  return {
    x: radius * Math.cos(angle),
    y: radius * Math.sin(angle)
  };
}

function transformPoint(point, tx = 0, ty = 0, rotation = 0) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: point.x * cos - point.y * sin + tx,
    y: point.x * sin + point.y * cos + ty
  };
}

function transformPoints(points, tx = 0, ty = 0, rotation = 0) {
  return points.map((point) => transformPoint(point, tx, ty, rotation));
}

function pointText(points) {
  return points.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(" ");
}

function involuteTheta(baseRadius, radius) {
  if (radius <= baseRadius) return 0;
  const t = Math.sqrt((radius / baseRadius) ** 2 - 1);
  return t - Math.atan(t);
}

function arcPoints(radius, startAngle, endAngle, steps) {
  const points = [];
  let delta = endAngle - startAngle;
  while (delta < 0) delta += Math.PI * 2;
  for (let i = 1; i <= steps; i += 1) {
    points.push(polar(radius, startAngle + delta * (i / steps)));
  }
  return points;
}

function alignToothAt(angle, teeth) {
  const pitch = Math.PI * 2 / teeth;
  const index = Math.round(angle / pitch);
  return angle - index * pitch;
}

function alignGapAt(angle, teeth) {
  const pitch = Math.PI * 2 / teeth;
  const index = Math.round(angle / pitch - 0.5);
  return angle - (index + 0.5) * pitch;
}

function gearMetrics(params, teeth = params.teeth, shift = params.shift) {
  const pitchRadius = params.module * teeth / 2;
  const baseRadius = pitchRadius * Math.cos(params.pressureAngle);
  const outerRadius = pitchRadius + params.module * (1 + shift);
  const rootRadius = Math.max(params.module * 0.35, pitchRadius - params.module * (1.25 - shift));
  return {
    teeth,
    module: params.module,
    pressureAngle: params.pressureAngle,
    pitchRadius,
    baseRadius,
    outerRadius,
    rootRadius,
    circularPitch: Math.PI * params.module
  };
}

function buildExternalGear(params, options = {}) {
  const metrics = gearMetrics(params, options.teeth ?? params.teeth, options.shift ?? params.shift);
  const z = metrics.teeth;
  const toothPitch = Math.PI * 2 / z;
  const backlash = (options.backlash ?? params.module * backlashFactor) / (2 * metrics.pitchRadius);
  const halfTooth = Math.max(
    toothPitch * 0.16,
    Math.PI / (2 * z) + (2 * (options.shift ?? params.shift) * Math.tan(params.pressureAngle)) / z - backlash
  );
  const startRadius = Math.max(metrics.rootRadius, metrics.baseRadius);
  const pitchTheta = involuteTheta(metrics.baseRadius, metrics.pitchRadius);
  const startTheta = involuteTheta(metrics.baseRadius, startRadius) - pitchTheta;
  const points = [];

  for (let tooth = 0; tooth < z; tooth += 1) {
    const center = tooth * toothPitch + (options.rotation ?? 0);
    const outerTheta = involuteTheta(metrics.baseRadius, metrics.outerRadius) - pitchTheta;
    const leftRootAngle = center - halfTooth + startTheta;
    const rightRootAngle = center + halfTooth - startTheta;
    const leftOuterAngle = center - halfTooth + outerTheta;
    const rightOuterAngle = center + halfTooth - outerTheta;
    const nextLeftRootAngle = center + toothPitch - halfTooth + startTheta;
    const leftFlank = [polar(metrics.rootRadius, leftRootAngle)];

    if (startRadius > metrics.rootRadius) {
      leftFlank.push(polar(startRadius, leftRootAngle));
    }

    for (let i = 1; i <= 12; i += 1) {
      const ratio = i / 12;
      const radius = startRadius + (metrics.outerRadius - startRadius) * ratio;
      const theta = involuteTheta(metrics.baseRadius, radius) - pitchTheta;
      leftFlank.push(polar(radius, center - halfTooth + theta));
    }

    const rightFlank = [];
    for (let i = 12; i >= 1; i -= 1) {
      const ratio = i / 12;
      const radius = startRadius + (metrics.outerRadius - startRadius) * ratio;
      const theta = involuteTheta(metrics.baseRadius, radius) - pitchTheta;
      rightFlank.push(polar(radius, center + halfTooth - theta));
    }

    if (startRadius > metrics.rootRadius) {
      rightFlank.push(polar(startRadius, rightRootAngle));
    }
    rightFlank.push(polar(metrics.rootRadius, rightRootAngle));

    points.push(
      ...leftFlank,
      ...arcPoints(metrics.outerRadius, leftOuterAngle, rightOuterAngle, 4),
      ...rightFlank,
      ...arcPoints(metrics.rootRadius, rightRootAngle, nextLeftRootAngle, 6)
    );
  }

  return {
    kind: "external",
    role: options.role ?? "gear",
    params,
    points: transformPoints(points, options.tx ?? 0, options.ty ?? 0),
    center: { x: options.tx ?? 0, y: options.ty ?? 0 },
    bore: options.bore ?? params.bore,
    layer: options.layer ?? "EXTERNAL_GEAR",
    ...metrics
  };
}

function buildInternalGear(params, options = {}) {
  const metrics = gearMetrics(params, params.teeth, params.shift);
  const outerRingRadius = metrics.rootRadius + Math.max(params.module * 4, metrics.pitchRadius * 0.18);
  const innerTipRadius = Math.max(params.module * 0.8, metrics.pitchRadius - params.module * (1 + params.shift));
  const innerRootRadius = metrics.pitchRadius + params.module * (1.25 - params.shift);
  const template = buildExternalGear(params, {
    teeth: params.teeth,
    bore: 0,
    layer: "INTERNAL_TEMPLATE"
  });
  const sourceSpan = Math.max(0.001, metrics.outerRadius - metrics.rootRadius);
  const targetSpan = innerRootRadius - innerTipRadius;
  const points = template.points.map((point) => {
    const radius = Math.hypot(point.x, point.y);
    const angle = Math.atan2(point.y, point.x);
    const ratio = Math.min(1, Math.max(0, (radius - metrics.rootRadius) / sourceSpan));
    return polar(innerRootRadius - ratio * targetSpan, angle);
  }).reverse();

  return {
    kind: "internal",
    role: "ring",
    params,
    points,
    center: { x: 0, y: 0 },
    teeth: metrics.teeth,
    module: params.module,
    pressureAngle: params.pressureAngle,
    pitchRadius: metrics.pitchRadius,
    baseRadius: metrics.baseRadius,
    outerRadius: outerRingRadius,
    rootRadius: innerRootRadius,
    tipRadius: innerTipRadius,
    circularPitch: metrics.circularPitch,
    layer: "INTERNAL_GEAR"
  };
}

function buildRack(params, options = {}) {
  const pitch = Math.PI * params.module;
  const count = options.teeth ?? params.teeth;
  const addendum = params.module;
  const dedendum = params.module * 1.25;
  const clearance = params.module * backlashFactor;
  const halfTop = Math.max(0.06 * pitch, params.module * (Math.PI / 4 - Math.tan(params.pressureAngle)) - clearance / 2);
  const halfRoot = Math.min(pitch * 0.45, pitch / 4 + dedendum * Math.tan(params.pressureAngle) - clearance / 2);
  const start = -count * pitch / 2;
  const points = [{ x: start, y: dedendum }];

  for (let i = 0; i < count; i += 1) {
    const center = start + (i + 0.5) * pitch;
    points.push(
      { x: center - halfRoot, y: dedendum },
      { x: center - halfTop, y: -addendum },
      { x: center + halfTop, y: -addendum },
      { x: center + halfRoot, y: dedendum }
    );
  }

  points.push({ x: start + count * pitch, y: dedendum }, { x: start + count * pitch, y: dedendum + params.module * 3 });
  points.push({ x: start, y: dedendum + params.module * 3 });

  return {
    kind: "rack",
    role: "rack",
    params,
    points: transformPoints(points, options.tx ?? 0, options.ty ?? 0),
    center: { x: options.tx ?? 0, y: options.ty ?? 0 },
    teeth: count,
    pitchRadius: 0,
    baseRadius: 0,
    outerRadius: Math.max(Math.abs(start), Math.abs(start + count * pitch)),
    rootRadius: dedendum,
    circularPitch: pitch,
    width: count * pitch,
    height: addendum + dedendum + params.module * 3,
    layer: "RACK"
  };
}

function circleElement(radius, className, cx = 0, cy = 0) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  el.setAttribute("cx", cx.toFixed(3));
  el.setAttribute("cy", cy.toFixed(3));
  el.setAttribute("r", radius.toFixed(3));
  el.setAttribute("class", className);
  return el;
}

function polygonElement(points, className) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  el.setAttribute("points", pointText(points));
  el.setAttribute("class", className);
  return el;
}

function circlePath(cx, cy, radius) {
  return [
    `M ${cx - radius},${cy}`,
    `A ${radius},${radius} 0 1 0 ${cx + radius},${cy}`,
    `A ${radius},${radius} 0 1 0 ${cx - radius},${cy}`,
    "Z"
  ].join(" ");
}

function pathElement(shape) {
  const inner = `M ${pointText(shape.points).replaceAll(" ", " L ")} Z`;
  const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
  el.setAttribute("d", `${circlePath(0, 0, shape.outerRadius)} ${inner}`);
  el.setAttribute("class", "gear-body internal-body");
  el.setAttribute("fill-rule", "evenodd");
  return el;
}

function sceneBounds(shapes) {
  const xs = [];
  const ys = [];
  for (const shape of shapes) {
    if (shape.kind === "internal") {
      xs.push(-shape.outerRadius, shape.outerRadius);
      ys.push(-shape.outerRadius, shape.outerRadius);
    }
    for (const point of shape.points) {
      xs.push(point.x);
      ys.push(point.y);
    }
    if (shape.kind === "external" && shape.bore > 0) {
      xs.push(shape.center.x - shape.bore / 2, shape.center.x + shape.bore / 2);
      ys.push(shape.center.y - shape.bore / 2, shape.center.y + shape.bore / 2);
    }
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const margin = Math.max(12, (maxX - minX + maxY - minY) * 0.035);
  return {
    x: minX - margin,
    y: minY - margin,
    width: maxX - minX + margin * 2,
    height: maxY - minY + margin * 2
  };
}

function buildScene(params) {
  const meshClearance = params.module * meshClearanceFactor;
  if (params.gearType === "rack") {
    const rack = buildRack(params);
    const shapes = [rack];
    let centerDistance = null;
    if (params.gearCount === 2) {
      const pinionMetrics = gearMetrics(params, params.teeth2);
      const pinion = buildExternalGear(params, {
        teeth: params.teeth2,
        bore: params.bore2,
        tx: 0,
        ty: -(pinionMetrics.pitchRadius + meshClearance),
        rotation: alignToothAt(Math.PI / 2, params.teeth2),
        layer: "PINION"
      });
      shapes.push(pinion);
      centerDistance = pinion.pitchRadius + meshClearance;
    }
    return { params, primary: rack, shapes, centerDistance };
  }

  if (params.gearType === "internal") {
    const ring = buildInternalGear(params);
    const shapes = [ring];
    let centerDistance = null;
    if (params.gearCount === 2) {
      const maxPinionTeeth = Math.max(6, params.teeth - 6);
      const pinionTeeth = Math.min(params.teeth2, maxPinionTeeth);
      params.teeth2 = pinionTeeth;
      controls.teeth2.value = pinionTeeth;
      const pinionMetrics = gearMetrics(params, pinionTeeth);
      centerDistance = ring.pitchRadius - pinionMetrics.pitchRadius - meshClearance;
      shapes.push(buildExternalGear(params, {
        teeth: pinionTeeth,
        bore: params.bore2,
        tx: centerDistance,
        ty: 0,
        rotation: alignToothAt(Math.PI, pinionTeeth),
        layer: "PINION"
      }));
    }
    return { params, primary: ring, shapes, centerDistance };
  }

  const gearA = buildExternalGear(params, {
    teeth: params.teeth,
    bore: params.bore,
    layer: "GEAR_1"
  });
  const shapes = [gearA];
  let centerDistance = null;
  if (params.gearCount === 2) {
    const gearBMetrics = gearMetrics(params, params.teeth2);
    centerDistance = gearA.pitchRadius + gearBMetrics.pitchRadius + meshClearance;
    gearA.points = transformPoints(gearA.points, -centerDistance / 2, 0);
    gearA.center = { x: -centerDistance / 2, y: 0 };
    shapes.push(buildExternalGear(params, {
      teeth: params.teeth2,
      bore: params.bore2,
      tx: centerDistance / 2,
      ty: 0,
      rotation: alignGapAt(Math.PI, params.teeth2),
      layer: "GEAR_2"
    }));
  }
  return { params, primary: gearA, shapes, centerDistance };
}

function renderShape(shape) {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("class", "motion-layer");
  shape.motionGroup = group;

  if (shape.kind === "internal") {
    group.appendChild(pathElement(shape));
    svg.appendChild(group);
    return;
  }
  group.appendChild(polygonElement(shape.points, shape.kind === "rack" ? "rack" : "gear-body"));
  if (shape.kind === "external" && shape.bore > 0) {
    group.appendChild(circleElement(shape.bore / 2, "bore", shape.center.x, shape.center.y));
  }
  svg.appendChild(group);
}

function renderGuides(shape) {
  if (shape.kind === "rack") return;
  svg.appendChild(circleElement(shape.pitchRadius, "guide", shape.center.x, shape.center.y));
  svg.appendChild(circleElement(shape.baseRadius, "guide", shape.center.x, shape.center.y));
  svg.appendChild(circleElement(shape.kind === "internal" ? shape.rootRadius : shape.outerRadius, "guide", shape.center.x, shape.center.y));
}

function setReadouts(scene) {
  const params = scene.params;
  const shape = scene.primary;
  const typeName = typeNames[params.gearType];
  const countText = params.gearCount === 2 ? "兩個" : "一個";
  const angle = (params.pressureAngle * 180 / Math.PI).toFixed(1);

  readouts.gearName.textContent = `${params.teeth} 齒${typeName}，${countText}`;
  readouts.statusText.textContent = `模數 ${params.module}，壓力角 ${angle}°，可下載 DXF`;
  readouts.circularPitch.textContent = mm(shape.circularPitch);
  readouts.centerDistance.textContent = scene.centerDistance == null ? "-" : mm(scene.centerDistance);
  readouts.distanceLabel.textContent = params.gearType === "rack" ? "小齒輪到節線" : "中心距";

  if (params.gearType === "rack") {
    readouts.pitchLabel.textContent = "齒條長度";
    readouts.outerLabel.textContent = "齒高";
    readouts.rootLabel.textContent = "齒數";
    readouts.pitchDiameter.textContent = mm(shape.width);
    readouts.outerDiameter.textContent = mm(shape.height);
    readouts.rootDiameter.textContent = `${params.teeth}`;
    readouts.baseDiameter.textContent = "-";
    return;
  }

  readouts.pitchLabel.textContent = "節圓直徑";
  readouts.pitchDiameter.textContent = mm(shape.pitchRadius * 2);
  readouts.baseDiameter.textContent = mm(shape.baseRadius * 2);

  if (params.gearType === "internal") {
    readouts.outerLabel.textContent = "外框直徑";
    readouts.rootLabel.textContent = "內齒根直徑";
    readouts.outerDiameter.textContent = mm(shape.outerRadius * 2);
    readouts.rootDiameter.textContent = mm(shape.rootRadius * 2);
  } else {
    readouts.outerLabel.textContent = "外徑";
    readouts.rootLabel.textContent = "齒根圓直徑";
    readouts.outerDiameter.textContent = mm(shape.outerRadius * 2);
    readouts.rootDiameter.textContent = mm(shape.rootRadius * 2);
  }
}

function syncFields(params) {
  controls.teeth.value = params.teeth;
  controls.teeth2.value = params.teeth2;
  controls.module.value = params.module;
  controls.bore.value = params.bore;
  controls.bore2.value = params.bore2;
  controls.shift.value = params.shift;
  readouts.teeth2Field.classList.toggle("is-hidden", params.gearCount !== 2);
  readouts.boreField.classList.toggle("is-hidden", params.gearType !== "external");
  readouts.bore2Field.classList.toggle("is-hidden", params.gearCount !== 2);
  syncDownloadTarget(params);
}

function syncDownloadTarget(params) {
  const labels = params.gearType === "rack"
    ? { all: "全部", primary: "齒條", secondary: "小齒輪" }
    : { all: "全部", primary: "第一個", secondary: "第二個" };

  for (const option of controls.downloadTarget.options) {
    option.textContent = labels[option.value];
    option.hidden = option.value === "secondary" && params.gearCount !== 2;
  }

  if (params.gearCount !== 2 && controls.downloadTarget.value === "secondary") {
    controls.downloadTarget.value = "primary";
    params.downloadTarget = "primary";
  }
}

function resetMotionTransforms() {
  if (!current) return;
  for (const shape of current.shapes) {
    if (shape.motionGroup) shape.motionGroup.removeAttribute("transform");
  }
}

function stopAnimation() {
  if (animationFrame != null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(animationFrame);
  }
  animationFrame = null;
  resetMotionTransforms();
}

function rotateShape(shape, angleRadians) {
  if (!shape.motionGroup) return;
  const degrees = angleRadians * 180 / Math.PI;
  shape.motionGroup.setAttribute("transform", `rotate(${degrees} ${shape.center.x} ${shape.center.y})`);
}

function translateShape(shape, dx, dy = 0) {
  if (!shape.motionGroup) return;
  shape.motionGroup.setAttribute("transform", `translate(${dx} ${dy})`);
}

function animatePreview(now) {
  if (!current || !current.params.animatePreview) {
    stopAnimation();
    return;
  }

  if (!animationStart) animationStart = now;
  const elapsed = (now - animationStart) / 1000;
  const angle = elapsed * current.params.animationSpeed * Math.PI * 0.9;
  const [first, second] = current.shapes;

  resetMotionTransforms();

  if (current.params.gearType === "rack") {
    if (second) {
      const pitch = first.circularPitch;
      const travel = (angle * second.pitchRadius) % pitch;
      translateShape(first, travel);
      rotateShape(second, -angle);
    } else {
      const travel = Math.sin(angle) * first.circularPitch * 0.75;
      translateShape(first, travel);
    }
  } else if (current.params.gearType === "internal") {
    if (second) {
      rotateShape(first, angle * second.teeth / first.teeth);
      rotateShape(second, angle);
    } else {
      rotateShape(first, angle);
    }
  } else if (second) {
    rotateShape(first, angle);
    rotateShape(second, -angle * first.teeth / second.teeth);
  } else {
    rotateShape(first, angle);
  }

  animationFrame = requestAnimationFrame(animatePreview);
}

function startAnimation() {
  stopAnimation();
  if (!current || !current.params.animatePreview || typeof requestAnimationFrame !== "function") return;
  animationStart = 0;
  animationFrame = requestAnimationFrame(animatePreview);
}

function render() {
  const params = getParams();
  stopAnimation();
  syncFields(params);
  current = buildScene(params);
  svg.replaceChildren();
  for (const shape of current.shapes) renderShape(shape);
  if (params.showGuides) {
    for (const shape of current.shapes) renderGuides(shape);
  }
  const bounds = sceneBounds(current.shapes);
  svg.setAttribute("viewBox", `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
  setReadouts(current);
  saveSettings(current.params);
  startAnimation();
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function dxfPolyline(points, layer, closed = true) {
  const header = ["0", "LWPOLYLINE", "8", layer, "90", String(points.length), "70", closed ? "1" : "0"];
  const coords = points.flatMap((p) => ["10", p.x.toFixed(4), "20", (-p.y).toFixed(4)]);
  return [...header, ...coords].join("\n");
}

function dxfCircle(cx, cy, radius, layer) {
  return ["0", "CIRCLE", "8", layer, "10", cx.toFixed(4), "20", (-cy).toFixed(4), "40", radius.toFixed(4)].join("\n");
}

function selectedExportShapes() {
  if (!current) return [];
  if (current.params.downloadTarget === "primary" || current.shapes.length === 1) return current.shapes.slice(0, 1);
  if (current.params.downloadTarget === "secondary") return current.shapes.slice(1, 2).length
    ? current.shapes.slice(1, 2)
    : current.shapes.slice(0, 1);
  return current.shapes;
}

function downloadTargetName() {
  if (!current) return "all";
  if (current.params.downloadTarget === "primary") return current.params.gearType === "rack" ? "rack" : "first";
  if (current.params.downloadTarget === "secondary") {
    if (current.params.gearType === "rack") return "pinion";
    if (current.params.gearType === "internal") return "inner-pinion";
    return "second";
  }
  return "all";
}

function exportDxf() {
  if (!current) render();
  const entities = [];

  for (const shape of selectedExportShapes()) {
    if (shape.kind === "internal") {
      entities.push(dxfCircle(0, 0, shape.outerRadius, "OUTER_PROFILE"));
      entities.push(dxfPolyline(shape.points, "INNER_TEETH"));
      continue;
    }
    entities.push(dxfPolyline(shape.points, shape.layer));
    if (shape.kind === "external" && shape.bore > 0) {
      entities.push(dxfCircle(shape.center.x, shape.center.y, shape.bore / 2, `${shape.layer}_BORE`));
    }
  }

  const dxf = [
    "0", "SECTION", "2", "HEADER",
    "9", "$INSUNITS", "70", "4",
    "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
    entities.join("\n"),
    "0", "ENDSEC", "0", "EOF"
  ].join("\n");

  const name = `${current.params.gearType}-${downloadTargetName()}-${current.params.teeth}t-m${current.params.module}.dxf`;
  download(name, dxf, "application/dxf");
}

Object.values(controls).forEach((control) => {
  control.addEventListener("input", render);
  control.addEventListener("change", render);
});

document.querySelector("#downloadDxf").addEventListener("click", exportDxf);
document.querySelector("#resetView").addEventListener("click", render);

loadSavedSettings();
render();

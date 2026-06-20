// ============================================================
//  SNIPER COLOR PICKER — Aplicación principal
//  "¿Qué ocurriría si Adobe reemplazara el clic del ratón
//   por un rifle de francotirador para seleccionar colores?"
// ============================================================

(function () {
  'use strict';

  // ============================================================
  //  CONSTANTES
  // ============================================================

  const CONST = {
    TAMANO_RUEDA: 512,        // resolución del canvas offscreen de la rueda
    RADIO_RUEDA: 240,         // radio en píxeles de la rueda cromática
    CENTRO_RUEDA: 256,        // centro de la rueda (TAMANO_RUEDA / 2)
    ZOOM_MIN: 1,
    ZOOM_MAX: 6,
    ZOOM_INICIAL: 1,
    DISTANCIA_FIJA: '1000m',
    GRAVEDAD_BASE: 115,       // valor base de gravedad (oscila ±35 simulando altitud)
    FACTOR_VIENTO: 1.5,       // multiplicador de velocidad de viento
    DISPERSION: 6,            // dispersión aleatoria por disparo (píxeles en espacio de rueda)
    VELOCIDAD_ZOOM: 0.2,      // cambio de zoom por paso de rueda
    RADIO_VIEWPORT: 0.42,     // fracción del canvas para el viewport circular
    DURACION_ANIMACION: 400,  // ms de duración de la animación de disparo
    INTERVALO_VIENTO_MIN: 2000,
    INTERVALO_VIENTO_MAX: 4000,
    VELOCIDAD_VIENTO_MIN: 5,
    VELOCIDAD_VIENTO_MAX: 35,
    PERIODO_GRAVEDAD: 10000,  // ms para un ciclo completo de oscilación de gravedad
  };

  // ============================================================
  //  ESTADO GLOBAL
  // ============================================================

  const estado = {
    // Posición de la mira en coordenadas de la rueda (0..TAMANO_RUEDA)
    posicionX: CONST.CENTRO_RUEDA,
    posicionY: CONST.CENTRO_RUEDA,

    zoom: CONST.ZOOM_INICIAL,

    // Estado del viento
    velocidadViento: 0,
    direccionViento: 1, // 1 = derecha, -1 = izquierda
    vientoTexto: '0 km/h',

    // Gravedad variable (simula altitud)
    gravedadActual: CONST.GRAVEDAD_BASE,
    tiempoInicio: 0,

    // Último disparo
    haDisparado: false,
    impactoX: null,
    impactoY: null,
    colorSeleccionado: null, // { r, g, b, hex, h, s, l }

    // Animación de trayectoria
    animacion: null, // { progreso, inicio, control, fin, tiempoInicio }
    temblor: 0,      // intensidad del screen shake
    destello: 0,     // intensidad del muzzle flash
    impactoVisible: false,

    contadorDisparos: 0,

    // Formatos bloqueados (hay que dispararles para ver/copiar)
    formatosBloqueados: {
      hex: true,
      rgb: true,
      hsl: true,
    },

    // Ratón
    mouseX: 0,
    mouseY: 0,
  };

  // ============================================================
  //  REFERENCIAS DOM
  // ============================================================

  const canvas = document.getElementById('canvas-alcance');
  const ctx = canvas.getContext('2d');
  let lienzoRueda = null;
  let ctxRueda = null;

  const elZoom = document.getElementById('valor-zoom');
  const elViento = document.getElementById('texto-viento');
  const elDisparos = document.getElementById('texto-disparos');
  const elAcierto = document.getElementById('texto-acierto');
  const elMuestra = document.getElementById('interior-muestra');
  const elHex = document.getElementById('valor-hex');
  const elRgb = document.getElementById('valor-rgb');
  const elHsl = document.getElementById('valor-hsl');
  const elVientoValor = document.getElementById('valor-viento');
  const elGravedad = document.getElementById('valor-gravedad');
  const notif = document.getElementById('notificacion-copiado');

  // ============================================================
  //  UTILIDADES DE COLOR
  // ============================================================

  function hsvARgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r1 = 0, g1 = 0, b1 = 0;
    if (h < 60) { r1 = c; g1 = x; b1 = 0; }
    else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }
    return {
      r: Math.round((r1 + m) * 255),
      g: Math.round((g1 + m) * 255),
      b: Math.round((b1 + m) * 255)
    };
  }

  function rgbAHex(r, g, b) {
    return '#' + [r, g, b].map(x => {
      const h = x.toString(16);
      return h.length === 1 ? '0' + h : h;
    }).join('').toUpperCase();
  }

  function rgbAHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
      case g: h = ((b - r) / d + 2) * 60; break;
      case b: h = ((r - g) / d + 4) * 60; break;
    }
    return {
      h: Math.round(h),
      s: Math.round(s * 100),
      l: Math.round(l * 100)
    };
  }

  // ============================================================
  //  GENERACIÓN DE LA RUEDA CROMÁTICA (offscreen canvas)
  // ============================================================

  function generarRuedaCromatica() {
    lienzoRueda = document.createElement('canvas');
    lienzoRueda.width = CONST.TAMANO_RUEDA;
    lienzoRueda.height = CONST.TAMANO_RUEDA;
    ctxRueda = lienzoRueda.getContext('2d');

    const imgData = ctxRueda.createImageData(CONST.TAMANO_RUEDA, CONST.TAMANO_RUEDA);
    const datos = imgData.data;
    const centro = CONST.CENTRO_RUEDA;
    const radio = CONST.RADIO_RUEDA;
    const radio2 = radio * radio;

    for (let py = 0; py < CONST.TAMANO_RUEDA; py++) {
      for (let px = 0; px < CONST.TAMANO_RUEDA; px++) {
        const dx = px - centro;
        const dy = py - centro;
        const dist2 = dx * dx + dy * dy;

        if (dist2 > radio2) continue;

        const dist = Math.sqrt(dist2);
        const rNorm = dist / radio;
        const angulo = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        const hue = angulo;

        let s, v;
        if (rNorm < 0.08) {
          // Centro blanco
          const t = rNorm / 0.08;
          s = 0;
          v = 1 - t * 0.15;
        } else if (rNorm < 0.35) {
          // Pasteles
          const t = (rNorm - 0.08) / 0.27;
          s = 0.15 + t * 0.55;
          v = 1;
        } else if (rNorm < 0.6) {
          // Saturados brillantes
          const t = (rNorm - 0.35) / 0.25;
          s = 0.7 + t * 0.3;
          v = 1;
        } else if (rNorm < 0.88) {
          // Saturados con leve oscurecimiento
          const t = (rNorm - 0.6) / 0.28;
          s = 1;
          v = 1 - t * 0.2;
        } else {
          // Borde oscurecido
          const t = (rNorm - 0.88) / 0.12;
          s = 1 - t * 0.3;
          v = 0.8 - t * 0.6;
        }

        s = Math.max(0, Math.min(1, s));
        v = Math.max(0, Math.min(1, v));

        const rgb = hsvARgb(hue, s, v);
        const idx = (py * CONST.TAMANO_RUEDA + px) * 4;
        datos[idx] = rgb.r;
        datos[idx + 1] = rgb.g;
        datos[idx + 2] = rgb.b;
        datos[idx + 3] = 255;
      }
    }

    ctxRueda.putImageData(imgData, 0, 0);

    // Dibujar un anillo en el borde
    ctxRueda.beginPath();
    ctxRueda.arc(centro, centro, radio, 0, Math.PI * 2);
    ctxRueda.strokeStyle = 'rgba(200, 200, 200, 0.15)';
    ctxRueda.lineWidth = 2;
    ctxRueda.stroke();

    // Pequeñas marcas de ángulo en el borde
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const x1 = centro + Math.cos(ang) * radio;
      const y1 = centro + Math.sin(ang) * radio;
      const x2 = centro + Math.cos(ang) * (radio - 8);
      const y2 = centro + Math.sin(ang) * (radio - 8);
      ctxRueda.beginPath();
      ctxRueda.moveTo(x1, y1);
      ctxRueda.lineTo(x2, y2);
      ctxRueda.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctxRueda.lineWidth = 1;
      ctxRueda.stroke();
    }

    // Dibujar botones de formato en la rueda (bloqueados)
    const botones = obtenerBotonesFormato();
    for (const btn of botones) {
      dibujarBotonRueda(btn, true);
    }
  }

  // ============================================================
  //  MUESTREO DE COLOR EN LA RUEDA
  // ============================================================

  function muestrearColor(x, y) {
    x = Math.round(Math.max(0, Math.min(CONST.TAMANO_RUEDA - 1, x)));
    y = Math.round(Math.max(0, Math.min(CONST.TAMANO_RUEDA - 1, y)));

    const dx = x - CONST.CENTRO_RUEDA;
    const dy = y - CONST.CENTRO_RUEDA;
    if (dx * dx + dy * dy > CONST.RADIO_RUEDA * CONST.RADIO_RUEDA) {
      return null; // fuera de la rueda
    }

    const pix = ctxRueda.getImageData(x, y, 1, 1).data;
    const r = pix[0], g = pix[1], b = pix[2];
    const hex = rgbAHex(r, g, b);
    const hsl = rgbAHsl(r, g, b);

    return { r, g, b, hex, h: hsl.h, s: hsl.s, l: hsl.l };
  }

  // ============================================================
  //  CÁLCULO BALÍSTICO
  // ============================================================

  function recalcularViento() {
    const velocidad = CONST.VELOCIDAD_VIENTO_MIN +
      Math.random() * (CONST.VELOCIDAD_VIENTO_MAX - CONST.VELOCIDAD_VIENTO_MIN);
    const direccion = Math.random() < 0.5 ? 1 : -1;
    estado.velocidadViento = Math.round(velocidad * 10) / 10;
    estado.direccionViento = direccion;
    estado.vientoTexto = estado.velocidadViento + ' km/h ' + (direccion === 1 ? '→' : '←');
    actualizarPanelBalistica();
  }

  function programarCambioViento() {
    const intervalo = CONST.INTERVALO_VIENTO_MIN +
      Math.random() * (CONST.INTERVALO_VIENTO_MAX - CONST.INTERVALO_VIENTO_MIN);
    setTimeout(() => {
      recalcularViento();
      programarCambioViento();
    }, intervalo);
  }

  function actualizarGravedad() {
    const ahora = performance.now();
    const transcurrido = ahora - estado.tiempoInicio;
    const fase = (transcurrido % CONST.PERIODO_GRAVEDAD) / CONST.PERIODO_GRAVEDAD;
    const oscilacion = Math.sin(fase * Math.PI * 2);
    estado.gravedadActual = Math.round(CONST.GRAVEDAD_BASE + oscilacion * 35);
  }

  function calcularPuntoImpacto() {
    const desvViento = estado.velocidadViento * estado.direccionViento * CONST.FACTOR_VIENTO;
    const desvGravedad = estado.gravedadActual;

    const dispersion = (Math.random() - 0.5) * 2 * CONST.DISPERSION;

    const ix = estado.posicionX + desvViento + dispersion;
    const iy = estado.posicionY + desvGravedad + dispersion;

    return {
      x: Math.max(0, Math.min(CONST.TAMANO_RUEDA - 1, ix)),
      y: Math.max(0, Math.min(CONST.TAMANO_RUEDA - 1, iy))
    };
  }

  // ============================================================
  //  RENDERIZADO DEL ALCANCE
  // ============================================================

  let anchoCanvas = 0, altoCanvas = 0;
  let centroX = 0, centroY = 0, radioViewport = 0;

  // Botones de formato fuera de la rueda cromática (en el mismo canvas)
  function obtenerBotonesFormato() {
    const sep = 60;
    const baseY = 500;
    return [
      {
        id: 'hex', label: 'HEX',
        x: 256 - sep, y: baseY, w: 50, h: 24
      },
      {
        id: 'rgb', label: 'RGB',
        x: 256, y: baseY, w: 50, h: 24
      },
      {
        id: 'hsl', label: 'HSL',
        x: 256 + sep, y: baseY, w: 50, h: 24
      },
    ];
  }

  function redimensionarCanvas() {
    const contenedor = document.getElementById('contenedor-alcance');
    const dpr = window.devicePixelRatio || 1;
    const w = contenedor.clientWidth;
    const h = contenedor.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    anchoCanvas = w;
    altoCanvas = h;
    centroX = w / 2;
    centroY = h / 2;
    radioViewport = Math.min(w, h) * CONST.RADIO_VIEWPORT;
  }

  function dibujarEscena() {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Screen shake
    if (estado.temblor > 0.5) {
      const sx = (Math.random() - 0.5) * estado.temblor;
      const sy = (Math.random() - 0.5) * estado.temblor;
      ctx.translate(sx, sy);
    }

    // Fondo oscuro
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, anchoCanvas, altoCanvas);

    // Área visible de la rueda en coordenadas de la rueda
    const tamanoVisible = (radioViewport * 2) / estado.zoom;
    const fuenteX = estado.posicionX - tamanoVisible / 2;
    const fuenteY = estado.posicionY - tamanoVisible / 2;

    // Clip circular del viewport
    ctx.save();
    ctx.beginPath();
    ctx.arc(centroX, centroY, radioViewport, 0, Math.PI * 2);
    ctx.clip();

    // Fondo dentro del viewport (negro)
    ctx.fillStyle = '#000';
    ctx.fillRect(centroX - radioViewport, centroY - radioViewport,
      radioViewport * 2, radioViewport * 2);

    // Dibujar la porción visible de la rueda
    if (lienzoRueda) {
      ctx.drawImage(
        lienzoRueda,
        fuenteX, fuenteY, tamanoVisible, tamanoVisible,
        centroX - radioViewport, centroY - radioViewport,
        radioViewport * 2, radioViewport * 2
      );

      // Impactos anteriores (marcas)
      if (estado.impactoVisible && estado.impactoX !== null) {
        const px = centroX + (estado.impactoX - estado.posicionX) * estado.zoom;
        const py = centroY + (estado.impactoY - estado.posicionY) * estado.zoom;

        if (px >= centroX - radioViewport && px <= centroX + radioViewport &&
          py >= centroY - radioViewport && py <= centroY + radioViewport) {
          ctx.beginPath();
          ctx.arc(px, py, 5, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(px, py, 6, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(px, py, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
        }
      }

      // Retícula (crosshair) — dentro del clip
      dibujarReticula();

      // Trayectoria del disparo — dentro del clip
      if (estado.animacion) {
        dibujarTrayectoriaAnimada();
      }

      // Indicadores de elevación/viento — dentro del clip
      dibujarIndicadoresAlcance();

      // Muzzle flash — dentro del clip
      if (estado.destello > 0) {
        const flashGrad = ctx.createRadialGradient(
          centroX, centroY + radioViewport * 0.7, 0,
          centroX, centroY + radioViewport * 0.7, radioViewport * 0.4
        );
        flashGrad.addColorStop(0, `rgba(255, 200, 100, ${estado.destello * 0.6})`);
        flashGrad.addColorStop(0.5, `rgba(255, 150, 50, ${estado.destello * 0.3})`);
        flashGrad.addColorStop(1, 'rgba(255, 100, 0, 0)');
        ctx.fillStyle = flashGrad;
        ctx.fillRect(centroX - radioViewport, centroY - radioViewport,
          radioViewport * 2, radioViewport * 2);
        estado.destello *= 0.85;
        if (estado.destello < 0.05) estado.destello = 0;
      }
    }

    ctx.restore();

    // Viñeta del alcance (bordes oscuros)
    const grad = ctx.createRadialGradient(
      centroX, centroY, radioViewport * 0.75,
      centroX, centroY, radioViewport
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.7, 'rgba(0,0,0,0)');
    grad.addColorStop(0.9, 'rgba(0,0,0,0.3)');
    grad.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(centroX, centroY, radioViewport, 0, Math.PI * 2);
    ctx.fill();

    // Borde exterior del alcance
    ctx.beginPath();
    ctx.arc(centroX, centroY, radioViewport, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(60, 60, 60, 0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function dibujarReticula() {
    const cx = centroX, cy = centroY;
    const r = radioViewport;
    const largo = r * 0.4;
    const gap = 8;

    // Líneas principales de la retícula (mil-dot style)
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
    ctx.lineWidth = 1;

    // Horizontal
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.85, cy);
    ctx.lineTo(cx - gap, cy);
    ctx.moveTo(cx + gap, cy);
    ctx.lineTo(cx + r * 0.85, cy);
    ctx.stroke();

    // Vertical
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.85);
    ctx.lineTo(cx, cy - gap);
    ctx.moveTo(cx, cy + gap);
    ctx.lineTo(cx, cy + r * 0.85);
    ctx.stroke();

    // Punto central (mil-dot)
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 255, 0, 0.7)';
    ctx.fill();

    // Marcas de "mildot" en la horizontal
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue;
      const x = cx + i * 20;
      if (Math.abs(x - cx) > r * 0.8) continue;
      ctx.beginPath();
      ctx.arc(x, cy, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 255, 0, 0.25)';
      ctx.fill();
    }

    // Marcas de "mildot" en la vertical
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue;
      const y = cy + i * 20;
      if (Math.abs(y - cy) > r * 0.8) continue;
      ctx.beginPath();
      ctx.arc(cx, y, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 255, 0, 0.25)';
      ctx.fill();
    }

    // Círculo exterior fino
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.08)';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Marcas de rango en el borde inferior
    for (let i = -5; i <= 5; i++) {
      if (i === 0) continue;
      const x = cx + i * 15;
      const y = cy + r * 0.78;
      if (Math.abs(x - cx) > r * 0.7) continue;
      ctx.beginPath();
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x, y + 4);
      ctx.strokeStyle = 'rgba(0, 255, 0, 0.15)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }

  function dibujarTrayectoriaAnimada() {
    const anim = estado.animacion;
    const t = Math.min(1, anim.progreso);

    if (t <= 0) return;

    // Puntos de la curva cuadrática de Bézier
    const p0x = anim.inicio.x, p0y = anim.inicio.y;
    const p1x = anim.control.x, p1y = anim.control.y;
    const p2x = anim.fin.x, p2y = anim.fin.y;

    // Dibujar la estela
    ctx.save();
    ctx.beginPath();

    for (let i = 0; i <= 1; i += 0.02) {
      if (i > t) break;
      const u = i;
      const bx = (1 - u) * (1 - u) * p0x + 2 * (1 - u) * u * p1x + u * u * p2x;
      const by = (1 - u) * (1 - u) * p0y + 2 * (1 - u) * u * p1y + u * u * p2y;
      if (i === 0) ctx.moveTo(bx, by);
      else ctx.lineTo(bx, by);
    }

    ctx.strokeStyle = `rgba(200, 200, 100, ${0.7 * (1 - t * 0.3)})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Bala en la posición actual (un pequeño círculo brillante)
    const bt = t;
    const balaX = (1 - bt) * (1 - bt) * p0x + 2 * (1 - bt) * bt * p1x + bt * bt * p2x;
    const balaY = (1 - bt) * (1 - bt) * p0y + 2 * (1 - bt) * bt * p1y + bt * bt * p2y;

    // Estela brillante detrás de la bala
    const gradBala = ctx.createRadialGradient(balaX, balaY, 0, balaX, balaY, 8);
    gradBala.addColorStop(0, 'rgba(255, 255, 200, 0.9)');
    gradBala.addColorStop(0.3, 'rgba(255, 200, 100, 0.4)');
    gradBala.addColorStop(1, 'rgba(255, 200, 100, 0)');
    ctx.fillStyle = gradBala;
    ctx.beginPath();
    ctx.arc(balaX, balaY, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function dibujarIndicadoresAlcance() {
    const cx = centroX, cy = centroY;
    const r = radioViewport;

    // Indicador de viento en la parte superior del viewport
    ctx.save();
    const vientoX = cx + (estado.direccionViento * Math.min(estado.velocidadViento * 0.8, r * 0.3));
    ctx.strokeStyle = 'rgba(0, 255, 100, 0.2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.7);
    ctx.lineTo(vientoX, cy - r * 0.7);
    ctx.stroke();
    ctx.setLineDash([]);

    // Flecha de viento
    const dir = estado.direccionViento;
    const flechaX = vientoX;
    const flechaY = cy - r * 0.7;
    ctx.beginPath();
    ctx.moveTo(flechaX + dir * 5, flechaY - 3);
    ctx.lineTo(flechaX + dir * 8, flechaY);
    ctx.lineTo(flechaX + dir * 5, flechaY + 3);
    ctx.strokeStyle = 'rgba(0, 255, 100, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }

  // ============================================================
  //  DISPARO
  // ============================================================

  function disparar() {
    if (estado.animacion) return;

    const impacto = calcularPuntoImpacto();
    const color = muestrearColor(impacto.x, impacto.y);

    estado.haDisparado = true;
    estado.impactoX = impacto.x;
    estado.impactoY = impacto.y;
    estado.contadorDisparos++;
    estado.temblor = 8;
    estado.destello = 1;
    estado.impactoVisible = true;

    // Re-bloquear todos los botones de formato al iniciar un disparo
    estado.formatosBloqueados = { hex: true, rgb: true, hsl: true };
    reiniciarBotonesRueda();

    // Iniciar animación de trayectoria
    const finPantalla = ruedaAPantalla(impacto.x, impacto.y);
    const iniPantalla = {
      x: centroX,
      y: centroY + radioViewport * 0.75
    };

    // El punto de control se desplaza por viento y gravedad
    const desvViento = estado.velocidadViento * estado.direccionViento * CONST.FACTOR_VIENTO * 0.5;
    const controlPantalla = {
      x: centroX + desvViento,
      y: centroY + radioViewport * 0.3
    };

    estado.animacion = {
      progreso: 0,
      inicio: iniPantalla,
      control: controlPantalla,
      fin: finPantalla,
      tiempoInicio: performance.now()
    };

    // Comprobar si el impacto acertó a un botón de formato (coordenadas de rueda)
    const botones = obtenerBotonesFormato();
    let formatoAcertado = null;
    for (const btn of botones) {
      const hw = btn.w / 2, hh = btn.h / 2;
      if (impacto.x >= btn.x - hw && impacto.x <= btn.x + hw &&
        impacto.y >= btn.y - hh && impacto.y <= btn.y + hh) {
        formatoAcertado = btn.id;
        break;
      }
    }

    if (formatoAcertado) {
      estado.formatosBloqueados[formatoAcertado] = false;
      actualizarBotonRueda(formatoAcertado);
    }

    // Actualizar color en la UI
    if (color) {
      estado.colorSeleccionado = color;
      actualizarPanelColor(color);
    } else {
      actualizarPanelSinColor();
    }

    actualizarPanelBalistica();
    elDisparos.textContent = 'Shots: ' + estado.contadorDisparos;
  }

  function ruedaAPantalla(rx, ry) {
    return {
      x: centroX + (rx - estado.posicionX) * estado.zoom,
      y: centroY + (ry - estado.posicionY) * estado.zoom
    };
  }

  function actualizarBotonRueda(id) {
    const btn = obtenerBotonesFormato().find(b => b.id === id);
    if (!btn) return;
    dibujarBotonRueda(btn, false);
  }

  // ============================================================
  //  ANIMACIONES
  // ============================================================

  function actualizarAnimaciones() {
    // Animación de trayectoria
    if (estado.animacion) {
      const ahora = performance.now();
      const transcurrido = ahora - estado.animacion.tiempoInicio;
      estado.animacion.progreso = transcurrido / CONST.DURACION_ANIMACION;

      if (estado.animacion.progreso >= 1) {
        estado.animacion = null;
      }
    }

    // Temblor
    if (estado.temblor > 0) {
      estado.temblor *= 0.88;
      if (estado.temblor < 0.3) estado.temblor = 0;
    }

    // Destello
    if (estado.destello > 0) {
      estado.destello *= 0.85;
      if (estado.destello < 0.02) estado.destello = 0;
    }
  }

  // ============================================================
  //  ACTUALIZACIÓN DE LA INTERFAZ
  // ============================================================

  function aplicarBloqueosUI() {
    const f = estado.formatosBloqueados;
    const hexVal = elHex.parentElement.querySelector('.btn-copiar');
    const rgbVal = elRgb.parentElement.querySelector('.btn-copiar');
    const hslVal = elHsl.parentElement.querySelector('.btn-copiar');
    if (f.hex) { elHex.textContent = '???'; hexVal.disabled = true; } else hexVal.disabled = false;
    if (f.rgb) { elRgb.textContent = '???'; rgbVal.disabled = true; } else rgbVal.disabled = false;
    if (f.hsl) { elHsl.textContent = '???'; hslVal.disabled = true; } else hslVal.disabled = false;
  }

  function actualizarPanelColor(color) {
    const estilo = `rgb(${color.r}, ${color.g}, ${color.b})`;
    elMuestra.style.background = estilo;
    if (!estado.formatosBloqueados.hex) elHex.textContent = color.hex;
    if (!estado.formatosBloqueados.rgb) elRgb.textContent = `${color.r}, ${color.g}, ${color.b}`;
    if (!estado.formatosBloqueados.hsl) elHsl.textContent = `${color.h}°, ${color.s}%, ${color.l}%`;
    aplicarBloqueosUI();

    const formatoNombres = { hex: 'HEX', rgb: 'RGB', hsl: 'HSL' };
    const todosDesbloqueados = !estado.formatosBloqueados.hex &&
      !estado.formatosBloqueados.rgb &&
      !estado.formatosBloqueados.hsl;
    if (todosDesbloqueados) {
      elAcierto.textContent = `✓ All formats — (${Math.round(estado.impactoX - CONST.CENTRO_RUEDA)}, ${Math.round(estado.impactoY - CONST.CENTRO_RUEDA)})`;
      elAcierto.style.color = '#0f0';
    } else {
      const bloqueados = [];
      if (estado.formatosBloqueados.hex) bloqueados.push('HEX');
      if (estado.formatosBloqueados.rgb) bloqueados.push('RGB');
      if (estado.formatosBloqueados.hsl) bloqueados.push('HSL');
      elAcierto.textContent = ` Shoot at: ${bloqueados.join(' · ')}`;
      elAcierto.style.color = '#f80';
    }
  }

  function actualizarPanelSinColor() {
    elMuestra.style.background = '#000';
    elHex.textContent = '—';
    elRgb.textContent = '—';
    elHsl.textContent = '—';
    elAcierto.textContent = 'Missed! Outside the wheel';
    elAcierto.style.color = '#f44';
    aplicarBloqueosUI();
  }

  function actualizarPanelBalistica() {
    elViento.textContent = estado.vientoTexto;
    elVientoValor.textContent = estado.vientoTexto;
    elGravedad.textContent = estado.gravedadActual.toFixed(0);
    elZoom.textContent = estado.zoom.toFixed(1) + 'x';
  }

  function dibujarBotonRueda(btn, bloqueado) {
    const bx = btn.x, by = btn.y;
    const mw = btn.w / 2, mh = btn.h / 2;
    if (bloqueado) {
      ctxRueda.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctxRueda.fillRect(bx - mw, by - mh, btn.w, btn.h);
      ctxRueda.strokeStyle = 'rgba(220, 50, 50, 0.7)';
      ctxRueda.lineWidth = 1.5;
      ctxRueda.strokeRect(bx - mw, by - mh, btn.w, btn.h);
      ctxRueda.fillStyle = 'rgba(255, 100, 100, 0.8)';
      ctxRueda.font = 'bold 11px Consolas, monospace';
      ctxRueda.textAlign = 'center';
      ctxRueda.textBaseline = 'middle';
      ctxRueda.fillText(btn.label, bx, by);
    } else {
      ctxRueda.fillStyle = 'rgba(0, 30, 0, 0.8)';
      ctxRueda.fillRect(bx - mw, by - mh, btn.w, btn.h);
      ctxRueda.strokeStyle = 'rgba(50, 220, 50, 0.8)';
      ctxRueda.lineWidth = 1.5;
      ctxRueda.strokeRect(bx - mw, by - mh, btn.w, btn.h);
      ctxRueda.fillStyle = '#4f4';
      ctxRueda.font = 'bold 11px Consolas, monospace';
      ctxRueda.textAlign = 'center';
      ctxRueda.textBaseline = 'middle';
      ctxRueda.fillText(btn.label, bx, by);
    }
  }

  function reiniciarBotonesRueda() {
    const botones = obtenerBotonesFormato();
    for (const btn of botones) {
      dibujarBotonRueda(btn, true);
    }
  }

  function limpiarImpacto() {
    estado.impactoVisible = false;
    estado.impactoX = null;
    estado.impactoY = null;
    estado.haDisparado = false;
    estado.animacion = null;
    estado.colorSeleccionado = null;
    estado.formatosBloqueados = { hex: true, rgb: true, hsl: true };
    reiniciarBotonesRueda();
    elMuestra.style.background = '#000';
    elHex.textContent = '???';
    elRgb.textContent = '???';
    elHsl.textContent = '???';
    document.querySelectorAll('.btn-copiar').forEach(b => b.disabled = true);
    elAcierto.textContent = 'Waiting for shot...';
    elAcierto.style.color = '#666';
  }

  function copiarPortapapeles(texto) {
    navigator.clipboard.writeText(texto).then(() => {
      notif.classList.add('visible');
      setTimeout(() => notif.classList.remove('visible'), 1500);
    }).catch(() => {
      // Fallback para navegadores sin clipboard API
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      notif.classList.add('visible');
      setTimeout(() => notif.classList.remove('visible'), 1500);
    });
  }

  // ============================================================
  //  CONFIGURACIÓN DE CONTROLES
  // ============================================================

  function configurarControles() {
    // Ratón — mover mira / disparar
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      estado.mouseX = mx;
      estado.mouseY = my;
    });

    canvas.addEventListener('click', (e) => {
      e.preventDefault();
      disparar();
    });

    // Rueda — zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaY < 0) {
        estado.zoom = Math.min(CONST.ZOOM_MAX, estado.zoom + CONST.VELOCIDAD_ZOOM);
      } else {
        estado.zoom = Math.max(CONST.ZOOM_MIN, estado.zoom - CONST.VELOCIDAD_ZOOM);
      }
      elZoom.textContent = estado.zoom.toFixed(1) + 'x';
    }, { passive: false });

    // Teclado
    document.addEventListener('keydown', (e) => {
      const tecla = e.key.toLowerCase();

      if (tecla === ' ') {
        e.preventDefault();
        disparar();
      } else if (tecla === 'r') {
        limpiarImpacto();
      }
    });

    // Botones de copiar
    document.querySelectorAll('.btn-copiar').forEach(btn => {
      btn.addEventListener('click', () => {
        const tipo = btn.dataset.tipo;
        if (!estado.colorSeleccionado || estado.formatosBloqueados[tipo]) return;
        const c = estado.colorSeleccionado;
        let texto = '';
        switch (tipo) {
          case 'hex': texto = c.hex; break;
          case 'rgb': texto = `${c.r}, ${c.g}, ${c.b}`; break;
          case 'hsl': texto = `${c.h}°, ${c.s}%, ${c.l}%`; break;
        }
        if (texto) copiarPortapapeles(texto);
      });
    });

    // Redimensionar ventana
    window.addEventListener('resize', redimensionarCanvas);
  }

  // ============================================================
  //  BUCLE DE PANEO POR RATÓN
  // ============================================================

  function actualizarPaneoPorRaton() {
    const cx = centroX, cy = centroY;
    const zonaMuerta = 8;
    const sensibilidad = 4 / estado.zoom;

    const dx = estado.mouseX - cx;
    const dy = estado.mouseY - cy;

    if (Math.abs(dx) > zonaMuerta) {
      const factor = Math.min(1, (Math.abs(dx) - zonaMuerta) / (cx - zonaMuerta));
      estado.posicionX += Math.sign(dx) * factor * sensibilidad;
    }
    if (Math.abs(dy) > zonaMuerta) {
      const factor = Math.min(1, (Math.abs(dy) - zonaMuerta) / (cy - zonaMuerta));
      estado.posicionY += Math.sign(dy) * factor * sensibilidad;
    }

    estado.posicionX = Math.max(0, Math.min(CONST.TAMANO_RUEDA, estado.posicionX));
    estado.posicionY = Math.max(0, Math.min(CONST.TAMANO_RUEDA, estado.posicionY));
  }

  // ============================================================
  //  BUCLE PRINCIPAL
  // ============================================================

  function buclePrincipal() {
    actualizarPaneoPorRaton();
    actualizarGravedad();
    actualizarAnimaciones();
    dibujarEscena();
    actualizarPanelBalistica();
    requestAnimationFrame(buclePrincipal);
  }

  // ============================================================
  //  INICIALIZACIÓN
  // ============================================================

  function inicializar() {
    console.log('🔭 Sniper Color Picker v1.0');
    console.log('  "An Adobe™ tool"');

    generarRuedaCromatica();
    redimensionarCanvas();
    recalcularViento();
    programarCambioViento();
    configurarControles();

    estado.tiempoInicio = performance.now();
    actualizarGravedad();

    estado.posicionX = CONST.CENTRO_RUEDA;
    estado.posicionY = CONST.CENTRO_RUEDA;

    limpiarImpacto();
    actualizarPanelBalistica();
    elDisparos.textContent = 'Shots: 0';

    buclePrincipal();
  }

  // Arranque cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
  } else {
    inicializar();
  }

})();

// CAPTURE MICRO → PCM 16 bits, 16 kHz. AudioWorklet, servi comme fichier
// statique (un worklet ne peut pas être empaqueté : le navigateur le charge
// par son URL, dans un contexte isolé du reste de la page).
//
// POURQUOI PAS ScriptProcessorNode
// Il est déprécié et surtout il travaille SUR LE FIL PRINCIPAL : au moindre
// rendu Vue un peu lourd, le son se hache. Un worklet tourne sur le fil audio,
// que rien de l'interface ne peut retarder.
//
// POURQUOI 16 kHz
// C'est ce qu'exige l'API Live en entrée : PCM brut, 16 bits, 16 kHz, mono,
// petit-boutiste. Lui envoyer du 48 kHz produit une voix de dessin animé —
// interprétée trois fois trop vite.
//
// LE RÉÉCHANTILLONNAGE EST UN REPLI, PAS LE CHEMIN NOMINAL. On demande à
// l'AudioContext de tourner directement à 16 kHz ; Chrome et Safari acceptent.
// Firefox impose parfois la fréquence de la carte son : dans ce cas seulement,
// on décime ici. L'interpolation linéaire suffit largement pour de la parole.

class CapturePcm extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const o = options?.processorOptions || {}
    this.cible = o.cible || 16000
    // `sampleRate` est fourni par le contexte du worklet.
    this.ratio = sampleRate / this.cible
    // ~64 ms à 16 kHz : assez court pour que la conversation reste vive, assez
    // long pour ne pas inonder la WebSocket d'un message toutes les 8 ms.
    this.taille = o.taille || 1024
    this.tampon = new Float32Array(this.taille)
    this.remplissage = 0
    this.position = 0
    this.actif = true
    this.port.onmessage = (e) => { if (e.data === 'stop') this.actif = false }
  }

  // Float −1..1 → entier signé 16 bits. Le bornage n'est pas décoratif : une
  // valeur hors plage repasse de l'autre côté par débordement et produit un
  // craquement franc.
  static versPcm16(flottants, n) {
    const out = new Int16Array(n)
    for (let i = 0; i < n; i++) {
      const v = Math.max(-1, Math.min(1, flottants[i]))
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
    }
    return out
  }

  process(entrees) {
    if (!this.actif) return false
    const canal = entrees[0]?.[0]
    if (!canal) return true

    if (this.ratio === 1) {
      for (let i = 0; i < canal.length; i++) {
        this.tampon[this.remplissage++] = canal[i]
        if (this.remplissage === this.taille) this.vider()
      }
    } else {
      // Décimation avec interpolation linéaire. `position` est conservée entre
      // deux blocs : sans cela, on introduirait une micro-coupure toutes les
      // 128 trames, audible comme un grésillement régulier.
      while (this.position < canal.length) {
        const i = Math.floor(this.position)
        const f = this.position - i
        const a = canal[i]
        const b = i + 1 < canal.length ? canal[i + 1] : a
        this.tampon[this.remplissage++] = a + (b - a) * f
        if (this.remplissage === this.taille) this.vider()
        this.position += this.ratio
      }
      this.position -= canal.length
    }
    return true
  }

  vider() {
    const pcm = CapturePcm.versPcm16(this.tampon, this.remplissage)
    // On TRANSFÈRE le tampon au lieu de le copier : à 16 messages par seconde,
    // la copie finirait par se voir dans le ramasse-miettes.
    this.port.postMessage(pcm.buffer, [pcm.buffer])
    this.remplissage = 0
  }
}

registerProcessor('pcm-capture', CapturePcm)

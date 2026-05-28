class Classify {
  classifyKp(kp) {
    if (!Number.isFinite(kp) || kp === undefined) {
      throw new Error(`Kp = ${kp} inválido`);
    }

    let level;
    let emergency_notification = false;

    if (kp <= 4) {
      level = "low";
    } else if (kp <= 7.99) {
      level = "moderate";
    } else {
      level = "severe";
      emergency_notification = true;
    }

    return { level, emergency_notification };
  }

  extractMaxKp(event) {
    if (event.kpIndex !== null && event.kpIndex !== undefined) {
      return event.kpIndex;
    }

    if (event.allKpIndex && event.allKpIndex.length > 0) {
      const kpValues = Math.max(...event.allKpIndex.map((k) => k.kpIndex));
      return kpValues;
    }

    return 0;
  }
}

module.exports = { Classify };

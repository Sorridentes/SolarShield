class Classify {
  classifyKp(kp) {
    if (!Number.isFinite(kp) || kp === undefined) {
      throw new Error(`Kp = ${kp} inválido`);
    }

    let classification;
    let emergency_notification = false;

    if (kp <= 4) {
      classification = "low";
    } else if (kp <= 7.99) {
      classification = "moderate";
    } else {
      classification = "severe";
      emergency_notification = true;
    }

    return { classification, emergency_notification };
  }

  extractMaxKp(event) {
    if (event.kpIndex !== null && event.kpIndex !== undefined) {
      return event.kpIndex;
    }

    if (event.allKpIndex && event.allKpIndex.length > 0) {
      const kpValues = event.allKpIndex.map((k) => k.kpIndex);
      return Math.max(...kpValues);
    }

    return 0;
  }
}

module.exports = { Classify };

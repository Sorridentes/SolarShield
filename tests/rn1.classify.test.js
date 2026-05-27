const {
  classifyKp,
  extractMaxKp,
} = require("../src/ingestor-service/classify");

describe("RN1 - Classificação de Tempestade Geomagnética por Índice Kp", () => {
  describe("Classificação para cada faixa de Kp", () => {
    test.each([
      // [kp, classification, emergencyNotification]
      [2.5, "low", false],
      [5, "moderate", false],
      [7.9, "moderate", false],
      [8, "severe", true],
    ])(
      "Kp=%i deve classificar como %s (emergency=%s)",
      (kp, expectedClassification, expectedEmergency) => {
        const result = classifyKp(kp);

        expect(result.classification).toBe(expectedClassification);
        expect(result.emergency_notification).toBe(expectedEmergency);
      },
    );
  });

  describe("Extrair Kp de eventos DONKI sem Kp direto", () => {
    test("deve extrair maior Kp do allKpIndex quando Kp principal não existe", () => {
      const donkiEvent = {
        gstID: "2024-11-15T05:00:00-GST-001",
        kpIndex: null, // sem Kp direto
        allKpIndex: [
          { kpIndex: 3, observedTime: "2024-11-15T04:00:00Z" },
          { kpIndex: 6, observedTime: "2024-11-15T05:00:00Z" },
          { kpIndex: 4, observedTime: "2024-11-15T06:00:00Z" },
        ],
      };

      const kp = extractMaxKp(donkiEvent);
      expect(kp).toBe(6);
    });

    test("deve usar Kp principal quando disponível", () => {
      const donkiEvent = {
        gstID: "2024-11-15T05:00:00-GST-001",
        kpIndex: 8,
        allKpIndex: [
          { kpIndex: 3, observedTime: "2024-11-15T04:00:00Z" },
          { kpIndex: 4, observedTime: "2024-11-15T05:00:00Z" },
        ],
      };

      const kp = extractMaxKp(donkiEvent);
      expect(kp).toBe(8);
    });
  });

  describe("Condições de borda", () => {
    test("deve lançar erro para Kp não numérico", () => {
      expect(classifyKp).toBeDefined();
      expect(() => classifyKp(null)).toThrow();
      expect(() => classifyKp(undefined)).toThrow();
      expect(() => classifyKp("abc")).toThrow();
    });
  });
});

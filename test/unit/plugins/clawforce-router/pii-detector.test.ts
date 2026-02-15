import { describe, it, expect } from "vitest";
import {
  detectPII,
  detectPIITypes,
  normalizeText,
  scanForPII,
} from "../../../../src/plugins/clawforce-router/pii-detector.js";

describe("detectPII", () => {
  describe("SSN detection", () => {
    it("should detect SSN with dashes", () => {
      expect(detectPII("my ssn is 123-45-6789")).toBe(true);
    });

    it("should detect SSN with spaces", () => {
      expect(detectPII("ssn: 123 45 6789")).toBe(true);
    });

    it("should not match partial SSN-like numbers", () => {
      expect(detectPII("order 12345678")).toBe(false);
    });

    it("should detect SSN without separators", () => {
      expect(detectPII("my ssn is 123456789")).toBe(true);
    });
  });

  describe("credit card detection", () => {
    it("should detect credit card with dashes", () => {
      expect(detectPII("card: 4111-1111-1111-1111")).toBe(true);
    });

    it("should detect credit card with spaces", () => {
      expect(detectPII("card: 4111 1111 1111 1111")).toBe(true);
    });

    it("should detect credit card without separators", () => {
      expect(detectPII("card: 4111111111111111")).toBe(true);
    });

    it("should not match short number sequences", () => {
      expect(detectPII("order #12345678")).toBe(false);
    });
  });

  describe("email detection", () => {
    it("should detect standard email", () => {
      expect(detectPII("contact john@example.com please")).toBe(true);
    });

    it("should detect email with subdomains", () => {
      expect(detectPII("user@mail.example.co.uk")).toBe(true);
    });

    it("should detect email with plus addressing", () => {
      expect(detectPII("john+test@gmail.com")).toBe(true);
    });

    it("should not match @ without domain", () => {
      expect(detectPII("hello @everyone")).toBe(false);
    });
  });

  describe("phone number detection", () => {
    it("should detect US phone with dashes", () => {
      expect(detectPII("call 555-123-4567")).toBe(true);
    });

    it("should detect US phone with parentheses", () => {
      expect(detectPII("call (555) 123-4567")).toBe(true);
    });

    it("should detect US phone with country code", () => {
      expect(detectPII("call +1-555-123-4567")).toBe(true);
    });

    it("should detect US phone with dots", () => {
      expect(detectPII("call 555.123.4567")).toBe(true);
    });
  });

  describe("keyword blocklist", () => {
    it("should detect blocklisted keywords", () => {
      expect(
        detectPII("send the password reset", { blocklist: ["password"] }),
      ).toBe(true);
    });

    it("should be case-insensitive for keywords", () => {
      expect(
        detectPII("my PASSWORD is...", { blocklist: ["password"] }),
      ).toBe(true);
    });

    it("should check all keywords in blocklist", () => {
      expect(
        detectPII("here is the secret key", {
          blocklist: ["password", "secret"],
        }),
      ).toBe(true);
    });

    it("should not match when no keywords found", () => {
      expect(
        detectPII("just a normal message", { blocklist: ["password"] }),
      ).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should return false for empty string", () => {
      expect(detectPII("")).toBe(false);
    });

    it("should return false for undefined-like empty text", () => {
      expect(detectPII("")).toBe(false);
    });

    it("should return false for normal text", () => {
      expect(detectPII("What is the weather in New York?")).toBe(false);
    });

    it("should detect multiple PII types in one message", () => {
      expect(
        detectPII("email: john@example.com, ssn: 123-45-6789"),
      ).toBe(true);
    });

    it("should work without options", () => {
      expect(detectPII("just text")).toBe(false);
    });

    it("should work with empty blocklist", () => {
      expect(detectPII("just text", { blocklist: [] })).toBe(false);
    });

    it("should not flag 10 consecutive digits as phone number", () => {
      expect(detectPII("there were 1234567890 items")).toBe(false);
    });

    it("should not flag credit card numbers as phone numbers", () => {
      const types = detectPIITypes("card: 4111111111111111");
      expect(types).toContain("credit_card");
      expect(types).not.toContain("phone");
    });
  });
});

describe("detectPIITypes", () => {
  it("should return all detected PII types", () => {
    const types = detectPIITypes("email: john@example.com, ssn: 123-45-6789");
    expect(types).toContain("ssn");
    expect(types).toContain("email");
  });

  it("should return blocklist when keyword matched", () => {
    const types = detectPIITypes("send the password", {
      blocklist: ["password"],
    });
    expect(types).toContain("blocklist");
  });

  it("should return empty array for clean text", () => {
    expect(detectPIITypes("hello world")).toEqual([]);
  });

  it("should return empty array for empty string", () => {
    expect(detectPIITypes("")).toEqual([]);
  });

  it("should not duplicate blocklist entry for multiple keyword matches", () => {
    const types = detectPIITypes("password and secret stuff", {
      blocklist: ["password", "secret"],
    });
    const blocklistCount = types.filter((t) => t === "blocklist").length;
    expect(blocklistCount).toBe(1);
  });
});

describe("Amex credit card detection", () => {
  it("should detect Amex starting with 34", () => {
    expect(detectPII("card: 340000000000009")).toBe(true);
  });

  it("should detect Amex starting with 37", () => {
    expect(detectPII("card: 370000000000002")).toBe(true);
  });

  it("should detect Amex with spaces", () => {
    expect(detectPII("card: 3400 000000 00009")).toBe(true);
  });

  it("should not match 15-digit numbers that don't start with 34 or 37", () => {
    expect(detectPII("code: 123456789012345")).toBe(false);
  });
});

describe("IBAN detection", () => {
  it("should detect German IBAN", () => {
    expect(detectPII("IBAN: DE89370400440532013000")).toBe(true);
  });

  it("should detect UK IBAN", () => {
    expect(detectPII("account: GB29NWBK60161331926819")).toBe(true);
  });

  it("should not match short codes", () => {
    expect(detectPII("code US12")).toBe(false);
  });
});

describe("date of birth detection", () => {
  it("should detect DOB with keyword", () => {
    expect(detectPII("date of birth: 01/15/1990")).toBe(true);
  });

  it("should detect dob abbreviation", () => {
    expect(detectPII("dob: 1990-01-15")).toBe(true);
  });

  it("should detect born on format", () => {
    expect(detectPII("born on 15/01/1990")).toBe(true);
  });

  it("should not match dates without DOB keyword", () => {
    expect(detectPII("meeting on 01/15/2026")).toBe(false);
  });
});

describe("IP address detection", () => {
  it("should detect standard IPv4", () => {
    expect(detectPII("server at 192.168.1.100")).toBe(true);
  });

  it("should detect edge case IPs", () => {
    expect(detectPII("address 255.255.255.255")).toBe(true);
    expect(detectPII("address 0.0.0.0")).toBe(true);
  });

  it("should not match invalid octets", () => {
    expect(detectPII("value 999.999.999.999")).toBe(false);
  });

  it("should not match version numbers", () => {
    expect(detectPII("version 1.2.3")).toBe(false);
  });
});

describe("passport detection", () => {
  it("should detect passport number with keyword", () => {
    expect(detectPII("passport number: 123456789")).toBe(true);
  });

  it("should detect passport no format", () => {
    expect(detectPII("passport no 987654321")).toBe(true);
  });

  it("should not match 9-digit numbers without passport keyword", () => {
    // Note: 123456789 now matches the SSN pattern (which accepts no separators).
    // Test with a number that doesn't match SSN grouping (too many in first group).
    expect(detectPII("passport? no, just code ABCD12345")).toBe(false);
  });
});

describe("driver's license detection", () => {
  it("should detect driver's license with keyword", () => {
    expect(detectPII("driver's license number: D12345678")).toBe(true);
  });

  it("should detect drivers licence (British spelling)", () => {
    expect(detectPII("drivers licence: 12345678")).toBe(true);
  });

  it("should detect with # sign", () => {
    expect(detectPII("driver license # A1234567890")).toBe(true);
  });

  it("should not match without keyword", () => {
    expect(detectPII("code D12345678")).toBe(false);
  });
});

describe("normalizeText", () => {
  it("should strip zero-width characters", () => {
    // Zero-width space between digits
    const result = normalizeText("123\u200B-\u200B45\u200B-\u200B6789");
    expect(result).toBe("123-45-6789");
  });

  it("should strip soft hyphens", () => {
    const result = normalizeText("4111\u00AD1111\u00AD1111\u00AD1111");
    expect(result).toBe("4111111111111111");
  });

  it("should strip zero-width joiners and non-joiners", () => {
    const result = normalizeText("test\u200C\u200Dvalue");
    expect(result).toBe("testvalue");
  });

  it("should fold Cyrillic homoglyphs to Latin", () => {
    // Cyrillic а, е, о look identical to Latin a, e, o
    const result = normalizeText("j\u043Ehn@\u0435x\u0430mple.com");
    expect(result).toBe("john@example.com");
  });

  it("should normalize fullwidth digits via NFKD", () => {
    // Fullwidth digits ０１２ → 012
    const result = normalizeText("\uFF11\uFF12\uFF13-\uFF14\uFF15-\uFF16\uFF17\uFF18\uFF19");
    expect(result).toBe("123-45-6789");
  });

  it("should strip combining marks after NFKD", () => {
    // é (U+00E9) → e + combining acute (U+0301) via NFKD → e after strip
    const result = normalizeText("caf\u00E9");
    expect(result).toBe("cafe");
  });

  it("should leave normal ASCII text unchanged", () => {
    const result = normalizeText("Hello World 123");
    expect(result).toBe("Hello World 123");
  });
});

describe("adversarial PII evasion", () => {
  it("should detect SSN with zero-width characters between digits", () => {
    expect(detectPII("my ssn is 123\u200B-\u200B45\u200B-\u200B6789")).toBe(true);
  });

  it("should detect email with Cyrillic homoglyphs", () => {
    // Replace 'o' with Cyrillic 'о' and 'e' with Cyrillic 'е'
    expect(detectPII("c\u043Entact j\u043Ehn@\u0435xample.c\u043Em")).toBe(true);
  });

  it("should detect credit card with soft hyphens", () => {
    expect(detectPII("card: 4111\u00AD1111\u00AD1111\u00AD1111")).toBe(true);
  });

  it("should detect SSN with fullwidth digits", () => {
    // Fullwidth: １２３-４５-６７８９
    expect(detectPII("ssn \uFF11\uFF12\uFF13-\uFF14\uFF15-\uFF16\uFF17\uFF18\uFF19")).toBe(true);
  });

  it("should detect phone with zero-width spaces", () => {
    expect(detectPII("call 555\u200B-\u200B123\u200B-\u200B4567")).toBe(true);
  });

  it("should detect blocklist keywords with homoglyphs", () => {
    // "password" with Cyrillic а and о
    expect(
      detectPII("p\u0430ssw\u043Erd", { blocklist: ["password"] }),
    ).toBe(true);
  });

  it("should still return correct PII types after normalization", () => {
    const types = detectPIITypes("ssn: 123\u200B-\u200B45\u200B-\u200B6789 email: j\u043Ehn@example.com");
    expect(types).toContain("ssn");
    expect(types).toContain("email");
  });

  it("should not false-positive on legitimate unicode text", () => {
    expect(detectPII("こんにちは世界")).toBe(false);
    expect(detectPII("Привет мир")).toBe(false);
    expect(detectPII("café résumé naïve")).toBe(false);
  });
});

describe("scanForPII", () => {
  it("should return empty array for clean text", () => {
    expect(scanForPII("Hello, this is normal text")).toEqual([]);
  });

  it("should return empty array for empty string", () => {
    expect(scanForPII("")).toEqual([]);
  });

  it("should return match with correct type and confidence for SSN", () => {
    const matches = scanForPII("my ssn is 123-45-6789");
    expect(matches.length).toBeGreaterThanOrEqual(1);
    const ssnMatch = matches.find((m) => m.type === "ssn");
    expect(ssnMatch).toBeDefined();
    expect(ssnMatch!.confidence).toBe(0.95);
    expect(ssnMatch!.matchedText).toBe("123-45-6789");
  });

  it("should return correct position for SSN", () => {
    const matches = scanForPII("my ssn is 123-45-6789");
    const ssnMatch = matches.find((m) => m.type === "ssn");
    expect(ssnMatch).toBeDefined();
    expect(ssnMatch!.position.start).toBe(10);
    expect(ssnMatch!.position.end).toBe(21);
  });

  it("should return correct confidence for email", () => {
    const matches = scanForPII("contact john@example.com please");
    const emailMatch = matches.find((m) => m.type === "email");
    expect(emailMatch).toBeDefined();
    expect(emailMatch!.confidence).toBe(0.85);
    expect(emailMatch!.matchedText).toBe("john@example.com");
  });

  it("should return correct confidence for phone", () => {
    const matches = scanForPII("call 555-123-4567 today");
    const phoneMatch = matches.find((m) => m.type === "phone");
    expect(phoneMatch).toBeDefined();
    expect(phoneMatch!.confidence).toBe(0.85);
  });

  it("should return correct confidence for credit card", () => {
    const matches = scanForPII("card 4111-1111-1111-1111");
    const ccMatch = matches.find((m) => m.type === "credit_card");
    expect(ccMatch).toBeDefined();
    expect(ccMatch!.confidence).toBe(0.95);
  });

  it("should return correct confidence for IBAN", () => {
    const matches = scanForPII("iban: GB29NWBK60161331926819");
    const ibanMatch = matches.find((m) => m.type === "iban");
    expect(ibanMatch).toBeDefined();
    expect(ibanMatch!.confidence).toBe(0.90);
  });

  it("should return correct confidence for DOB", () => {
    const matches = scanForPII("date of birth: 1990-01-15");
    const dobMatch = matches.find((m) => m.type === "dob");
    expect(dobMatch).toBeDefined();
    expect(dobMatch!.confidence).toBe(0.75);
  });

  it("should return correct confidence for IP address", () => {
    const matches = scanForPII("server at 192.168.1.100 is down");
    const ipMatch = matches.find((m) => m.type === "ip_address");
    expect(ipMatch).toBeDefined();
    expect(ipMatch!.confidence).toBe(0.75);
  });

  it("should return multiple matches from a single string", () => {
    const matches = scanForPII(
      "SSN 123-45-6789 email john@example.com call 555-123-4567",
    );
    const types = matches.map((m) => m.type);
    expect(types).toContain("ssn");
    expect(types).toContain("email");
    expect(types).toContain("phone");
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("should return blocklist matches with 0.70 confidence", () => {
    const matches = scanForPII("this contains a secret keyword", {
      blocklist: ["secret"],
    });
    const blocklistMatch = matches.find((m) => m.type === "blocklist");
    expect(blocklistMatch).toBeDefined();
    expect(blocklistMatch!.confidence).toBe(0.70);
    expect(blocklistMatch!.matchedText).toBe("secret");
  });

  it("should return correct positions for blocklist matches", () => {
    const matches = scanForPII("before secret after", {
      blocklist: ["secret"],
    });
    const blocklistMatch = matches.find((m) => m.type === "blocklist");
    expect(blocklistMatch).toBeDefined();
    expect(blocklistMatch!.position.start).toBe(7);
    expect(blocklistMatch!.position.end).toBe(13);
  });

  it("should find all occurrences of the same pattern", () => {
    const matches = scanForPII("john@example.com and jane@example.com");
    const emailMatches = matches.filter((m) => m.type === "email");
    expect(emailMatches.length).toBe(2);
    expect(emailMatches[0].matchedText).toBe("john@example.com");
    expect(emailMatches[1].matchedText).toBe("jane@example.com");
  });

  it("should work with backward-compat detectPII wrapper", () => {
    expect(detectPII("ssn 123-45-6789")).toBe(true);
    expect(detectPII("clean text")).toBe(false);
  });

  it("should work with backward-compat detectPIITypes wrapper", () => {
    const types = detectPIITypes("ssn 123-45-6789 email john@example.com");
    expect(types).toContain("ssn");
    expect(types).toContain("email");
  });

  it("should deduplicate types in detectPIITypes", () => {
    const types = detectPIITypes("john@example.com and jane@example.com");
    const emailCount = types.filter((t) => t === "email").length;
    expect(emailCount).toBe(1);
  });

  it("should find all occurrences of blocklist keyword", () => {
    const matches = scanForPII("secret data and more secret stuff with secret info", {
      blocklist: ["secret"],
    });
    const blocklistMatches = matches.filter((m) => m.type === "blocklist");
    expect(blocklistMatches.length).toBe(3);
  });

  it("should return all blocklist positions correctly", () => {
    const matches = scanForPII("aa secret bb secret cc", {
      blocklist: ["secret"],
    });
    const blocklistMatches = matches.filter((m) => m.type === "blocklist");
    expect(blocklistMatches.length).toBe(2);
    expect(blocklistMatches[0].position.start).toBe(3);
    expect(blocklistMatches[1].position.start).toBe(13);
  });
});

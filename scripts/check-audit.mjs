import { spawnSync } from "node:child_process";

const allowedImageSizeAdvisories = new Map([
  [1138808, "GHSA-w3rx-r6r6-pgpr"],
  [1138809, "GHSA-5p2g-fcmc-qvqq"],
]);
const blockingSeverities = new Set(["high", "critical"]);

const audit = spawnSync("npm", ["audit", "--json"], {
  cwd: process.cwd(),
  encoding: "utf8",
});

if (!audit.stdout.trim()) {
  throw new Error(`npm audit returned no JSON:\n${audit.stderr.trim()}`);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch (error) {
  throw new Error(`npm audit returned invalid JSON: ${error.message}`);
}

const vulnerabilities = report.vulnerabilities ?? {};
const imageSize = vulnerabilities["image-size"];
const imageSizeAdvisories = Array.isArray(imageSize?.via)
  ? imageSize.via.filter((entry) => typeof entry === "object" && entry !== null)
  : [];
const imageSizeExceptionIsExact =
  imageSize?.severity === "high" &&
  imageSizeAdvisories.length === allowedImageSizeAdvisories.size &&
  imageSizeAdvisories.every(
    (entry) =>
      allowedImageSizeAdvisories.get(entry.source) &&
      entry.url ===
        `https://github.com/advisories/${allowedImageSizeAdvisories.get(entry.source)}`,
  );

const accepted = [];
const blocked = [];
for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
  if (!blockingSeverities.has(vulnerability.severity)) {
    continue;
  }

  const isAcceptedImageSize = name === "image-size" && imageSizeExceptionIsExact;
  const isAcceptedPptxgenjsPath =
    name === "pptxgenjs" &&
    imageSizeExceptionIsExact &&
    Array.isArray(vulnerability.via) &&
    vulnerability.via.length === 1 &&
    vulnerability.via[0] === "image-size";

  if (isAcceptedImageSize || isAcceptedPptxgenjsPath) {
    accepted.push(name);
  } else {
    blocked.push(`${name} (${vulnerability.severity})`);
  }
}

if (blocked.length > 0) {
  throw new Error(`Release audit failed:\n- ${blocked.join("\n- ")}`);
}

if (accepted.length > 0) {
  process.stdout.write(
    [
      "Release audit OK with a temporary, exact exception:",
      "- image-size ICNS/JXL/HEIF denial-of-service advisories have no patched release",
      "- Editable Slides rejects those file extensions before image parsing",
      "- any new high/critical advisory still fails this check",
      "",
    ].join("\n"),
  );
} else {
  process.stdout.write("Release audit OK: no high or critical vulnerabilities\n");
}

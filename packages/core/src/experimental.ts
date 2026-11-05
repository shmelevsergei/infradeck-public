export type ExperimentalFeature = "BACKUPS" | "SSH_ROTATION";

export function experimentalEnabled(feature: ExperimentalFeature) {
  return process.env[`INFRADECK_EXPERIMENTAL_${feature}`] === "true";
}

export function requireExperimental(feature: ExperimentalFeature) {
  if (!experimentalEnabled(feature))
    throw new Error(
      `Experimental ${feature} is disabled by the installation administrator`,
    );
}

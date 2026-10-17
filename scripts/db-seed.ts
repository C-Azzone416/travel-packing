import { realDeps, runSeedCli } from "../src/server/seed/cli";

runSeedCli(process.argv.slice(2), process.env, realDeps).then((code) => process.exit(code));

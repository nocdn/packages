import process from "node:process"
import { bothFixtures } from "../test/fixtures.js"
process.stdout.write(JSON.stringify(await bothFixtures(process.argv[2])) + "\n")

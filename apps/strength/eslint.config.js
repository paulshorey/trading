import mantine from 'eslint-config-mantine'
import { nextJsConfig } from '@repo/eslint-config/next-js'

/** @type {import("eslint").Linter.Config} */
export default {
  ...mantine,
  ...nextJsConfig,
}

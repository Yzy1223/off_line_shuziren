import { spawn } from 'node:child_process'

export async function runCommand(command, args, options = {}) {
  const { cwd = process.cwd(), env = process.env, timeoutMs = 300000 } = options

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })

    child.on('close', (code) => {
      clearTimeout(timer)

      if (timedOut) {
        reject(new Error(`Command timed out: ${command} ${args.join(' ')}`))
        return
      }

      if (code !== 0) {
        const message = stderr.trim() || stdout.trim() || `Command failed with exit code ${code}`
        reject(new Error(message))
        return
      }

      resolve({
        code,
        stdout,
        stderr
      })
    })
  })
}

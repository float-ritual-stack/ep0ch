/** The call that binds this session to an outline, with a real name: `outline_bind {"name":"garden"}`. */
export function bindCall(name: string, machine?: string | null): string {
  return `outline_bind ${JSON.stringify({ name, ...(machine ? { machine } : {}) })}`
}

export interface OutlineListing {
  outlines: { name: string; machine: string | null }[]
  hosts: { machine: string | null; problem?: string }[]
}

/** The CLI's rows include hosts with no outlines, and hosts that did not answer. Keep both. */
export function outlineListing(stdout: string): OutlineListing {
  const outlines: OutlineListing['outlines'] = [], hosts: OutlineListing['hosts'] = []
  for (const line of stdout.split('\n').filter(Boolean)) {
    const [name, where, problem] = line.split('\t')
    const machine = where || null
    hosts.push({ machine, ...(problem ? { problem } : {}) })
    if (name) outlines.push({ name, machine })
  }
  return { outlines, hosts }
}

/** Only an answering host can say that the requested outline is absent. */
export function bindingProblem(listed: OutlineListing, name: string, machine?: string): string | null {
  const same = (o: { machine: string | null }) => o.machine === (machine ?? null)
  const host = listed.hosts.find(same)
  if (!host) return `the outline host${machine ? ` on ${machine}` : ' on this machine'} was not checked. Run \`ep0ch outline list${machine ? ` --machine ${machine}` : ' --here'}\`, then try ${bindCall(name, machine)} again.`
  if (host.problem) return host.problem
  if (listed.outlines.some(o => o.name === name && same(o))) return null
  const here = listed.outlines.filter(same).map(o => o.name)
  const other = listed.outlines.filter(o => o.name === name && !same(o)).map(o => o.machine)
  return `there is no outline "${name}"${machine ? ` on ${machine}` : ' on this machine'}${other.length ? ` (a "${name}" is on ${other.map(m => m ?? 'this machine').join(', ')}: ${bindCall(name, other[0])})` : ''}. ${here.length ? `Here: ${here.join(', ')}; e.g. ${bindCall(here[0]!, machine)}.` : 'Run \`ep0ch outline list --all\`.'}`
}

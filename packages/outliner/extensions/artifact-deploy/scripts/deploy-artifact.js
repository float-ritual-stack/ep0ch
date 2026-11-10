// ep0ch-script effects=write
// Deploys the ep0ch-artifacts repos the note it runs on names ([artifact::…] on its header or a line of its own): the
// kit's rule runs it on each save of such a note. The deploy itself is the service's (artifact_deploy), recorded as
// an artifact-run note under the catalogue.
text(await tools.artifact_deploy({ note: this.id }));

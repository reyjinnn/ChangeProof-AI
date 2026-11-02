/* Enterprise (T-49, WP3-31/32): BYOK credential metadata, the SAML
 * connection, and SCIM tokens. Key material never appears here — BYOK
 * values onboard out-of-band through the CLI secrets file, and SCIM
 * tokens display once at creation. There is no credential/token
 * listing endpoint, so lookup and revoke take pasted ids (recorded
 * gap, shown, not faked). */

import { apiGet, apiPost, ApiRequestError } from '../api.js';
import { badge, emptyState, errorState, h } from '../components.js';
import { registerRoute } from '../routes.js';

interface EnterpriseSession {
  readonly authenticated: boolean;
}

interface ByokCredential {
  readonly refId: string;
  readonly provider: string;
  readonly model: string;
  readonly fingerprint: string;
  readonly status: string;
  readonly rotationVersion: number;
}

interface SamlConnection {
  readonly entityId: string;
  readonly idpIssuer: string;
  readonly audience: string;
  readonly acsUrl: string;
  readonly certFingerprint: string;
  readonly verifiedDomain: string;
  readonly status: string;
}

function asErrorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.failure.message : 'An unexpected error occurred.';
}

function loginCard(outlet: HTMLElement): void {
  outlet.replaceChildren(
    h('section', { class: 'card' }, [
      h('h1', {}, ['Enterprise needs a login']),
      h('p', {}, ['Log in to manage credentials, single sign-on, and directory sync.']),
      h('p', {}, [h('a', { class: 'button primary', href: '#/login' }, ['Log in'])]),
    ]),
  );
}

function labeledInput(id: string, label: string, type = 'text'): HTMLElement {
  const field = h('input', { type, id, maxlength: '200' });
  field.setAttribute('aria-label', label);
  return h('label', {}, [label, field]);
}

function labeledTextarea(id: string, label: string): HTMLElement {
  const field = h('textarea', { id, rows: '4' });
  field.setAttribute('aria-label', label);
  return h('label', {}, [label, field]);
}

function note(text = ''): HTMLElement {
  return h('p', { 'aria-live': 'polite' }, [text]);
}

function renderByokCard(): HTMLElement {
  const provisionNote = note();
  const lookupNote = note();
  const detail = h('div', {}, []);
  let currentRef: string | null = null;

  const provision = h('button', { id: 'byok-provision', class: 'button primary', type: 'button' }, ['Provision']);
  provision.addEventListener('click', () => {
    const refId = (document.getElementById('byok-ref') as HTMLInputElement).value.trim();
    const provider = (document.getElementById('byok-provider') as HTMLInputElement).value.trim();
    const model = (document.getElementById('byok-model') as HTMLInputElement).value.trim();
    const fingerprint = (document.getElementById('byok-fingerprint') as HTMLInputElement).value.trim();
    provisionNote.replaceChildren('Provisioning…');
    void apiPost<{ refId: string; duplicate: boolean }>('/api/byok/credentials', {
      refId,
      provider,
      model,
      fingerprint,
    })
      .then((result) => {
        provisionNote.replaceChildren(
          result.duplicate ? `${result.refId} was already provisioned.` : `${result.refId} provisioned.`,
        );
      })
      .catch((error: unknown) => {
        provisionNote.replaceChildren(asErrorMessage(error));
      });
  });

  const rotateNote = note();
  const rotate = h('button', { id: 'byok-rotate', class: 'button', type: 'button' }, ['Rotate']);
  rotate.addEventListener('click', () => {
    if (currentRef === null) return;
    const newFingerprint = (document.getElementById('byok-new-fingerprint') as HTMLInputElement).value.trim();
    rotateNote.replaceChildren('Rotating…');
    void apiPost<{ refId: string; rotationVersion: number }>(`/api/byok/credentials/${currentRef}/rotate`, {
      newFingerprint,
    })
      .then((result) => {
        rotateNote.replaceChildren(`${result.refId} rotated to rotation ${result.rotationVersion}.`);
      })
      .catch((error: unknown) => {
        rotateNote.replaceChildren(asErrorMessage(error));
      });
  });

  const revokeNote = note();
  const revoke = h('button', { id: 'byok-revoke', class: 'button', type: 'button' }, ['Revoke']);
  revoke.addEventListener('click', () => {
    if (currentRef === null) return;
    revokeNote.replaceChildren('Revoking…');
    void apiPost<{ refId: string; revoked: boolean }>(`/api/byok/credentials/${currentRef}/revoke`, {})
      .then((result) => {
        revokeNote.replaceChildren(result.revoked ? `${result.refId} revoked.` : `${result.refId} was already revoked.`);
      })
      .catch((error: unknown) => {
        revokeNote.replaceChildren(asErrorMessage(error));
      });
  });

  const lookup = h('button', { id: 'byok-lookup', class: 'button', type: 'button' }, ['Look up']);
  lookup.addEventListener('click', () => {
    const refId = (document.getElementById('byok-lookup-ref') as HTMLInputElement).value.trim();
    lookupNote.replaceChildren('Reading…');
    detail.replaceChildren();
    void apiGet<ByokCredential>(`/api/byok/credentials/${refId}`)
      .then((credential) => {
        currentRef = credential.refId;
        lookupNote.replaceChildren('');
        detail.replaceChildren(
          h('dl', {}, [
            h('dt', {}, ['Provider']),
            h('dd', {}, [credential.provider]),
            h('dt', {}, ['Model']),
            h('dd', {}, [credential.model]),
            h('dt', {}, ['Fingerprint']),
            h('dd', {}, [h('code', {}, [credential.fingerprint])]),
            h('dt', {}, ['Status']),
            h('dd', {}, [badge(credential.status === 'active' ? 'ok' : 'warn', credential.status)]),
            h('dt', {}, ['Rotation']),
            h('dd', {}, [String(credential.rotationVersion)]),
          ]),
          labeledInput('byok-new-fingerprint', 'New fingerprint'),
          rotate,
          rotateNote,
          revoke,
          revokeNote,
        );
      })
      .catch((error: unknown) => {
        currentRef = null;
        lookupNote.replaceChildren(asErrorMessage(error));
      });
  });

  return h('section', { class: 'card' }, [
    h('h2', {}, ['BYOK credentials']),
    h('p', {}, [
      'Only metadata lives here: the key value itself is placed out-of-band through the CLI secrets file before provisioning, and fingerprints are the only key-derived bytes the API returns.',
    ]),
    h('h3', {}, ['Provision a credential']),
    labeledInput('byok-ref', 'Reference id'),
    labeledInput('byok-provider', 'Provider'),
    labeledInput('byok-model', 'Model'),
    labeledInput('byok-fingerprint', 'Fingerprint (64 hex)'),
    provision,
    provisionNote,
    h('h3', {}, ['Look up a credential']),
    h('p', {}, ['There is no credential listing; paste a reference id to read, rotate, or revoke it.']),
    labeledInput('byok-lookup-ref', 'Reference id'),
    lookup,
    lookupNote,
    detail,
  ]);
}

function renderSamlCard(): HTMLElement {
  const card = h('section', { class: 'card' }, []);
  const body = h('div', {}, []);

  async function refresh(): Promise<void> {
    body.replaceChildren(emptyState('Loading…', 'Reading the SAML connection.'));
    let connection: SamlConnection | null;
    try {
      connection = await apiGet<SamlConnection | null>('/api/enterprise/saml');
    } catch (error) {
      body.replaceChildren(
        errorState('SAML unavailable', asErrorMessage(error), {
          label: 'Retry',
          onClick: () => void refresh(),
        }),
      );
      return;
    }
    if (connection === null) {
      const provisionNote = note();
      const provision = h('button', { id: 'saml-provision', class: 'button primary', type: 'button' }, ['Provision']);
      provision.addEventListener('click', () => {
        const payload = {
          entityId: (document.getElementById('saml-entity') as HTMLInputElement).value.trim(),
          idpIssuer: (document.getElementById('saml-issuer') as HTMLInputElement).value.trim(),
          audience: (document.getElementById('saml-audience') as HTMLInputElement).value.trim(),
          acsUrl: (document.getElementById('saml-acs') as HTMLInputElement).value.trim(),
          certPem: (document.getElementById('saml-cert') as HTMLInputElement).value.trim(),
          verifiedDomain: (document.getElementById('saml-domain') as HTMLInputElement).value.trim(),
        };
        provisionNote.replaceChildren('Provisioning…');
        void apiPost<SamlConnection>('/api/enterprise/saml', payload)
          .then(() => refresh())
          .catch((error: unknown) => {
            provisionNote.replaceChildren(asErrorMessage(error));
          });
      });
      body.replaceChildren(
        h('p', {}, ['No SAML connection yet. Provisioning pins this organization to one identity provider.']),
        labeledInput('saml-entity', 'Entity id'),
        labeledInput('saml-issuer', 'IdP issuer'),
        labeledInput('saml-audience', 'Audience'),
        labeledInput('saml-acs', 'ACS URL'),
        labeledTextarea('saml-cert', 'Certificate (PEM)'),
        labeledInput('saml-domain', 'Verified domain'),
        provision,
        provisionNote,
      );
      return;
    }

    const actionNote = note();
    const rotate = h('button', { id: 'saml-rotate', class: 'button', type: 'button' }, ['Rotate certificate']);
    rotate.addEventListener('click', () => {
      const certPem = (document.getElementById('saml-rotate-cert') as HTMLInputElement).value.trim();
      actionNote.replaceChildren('Rotating…');
      void apiPost<SamlConnection>('/api/enterprise/saml/rotate', { certPem })
        .then(() => refresh())
        .catch((error: unknown) => {
          actionNote.replaceChildren(asErrorMessage(error));
        });
    });
    const link = h('button', { id: 'saml-link', class: 'button', type: 'button' }, ['Link subject']);
    link.addEventListener('click', () => {
      const subject = (document.getElementById('saml-subject') as HTMLInputElement).value.trim();
      const userId = (document.getElementById('saml-user') as HTMLInputElement).value.trim();
      actionNote.replaceChildren('Linking…');
      void apiPost<{ subject: string; userId: string }>('/api/enterprise/saml/link', { subject, userId })
        .then((result) => {
          actionNote.replaceChildren(`Linked ${result.subject} to ${result.userId}.`);
        })
        .catch((error: unknown) => {
          actionNote.replaceChildren(asErrorMessage(error));
        });
    });
    const disable = h('button', { id: 'saml-disable', class: 'button', type: 'button' }, ['Disable']);
    disable.addEventListener('click', () => {
      actionNote.replaceChildren('Disabling…');
      void apiPost<{ disabled: boolean }>('/api/enterprise/saml/disable', {})
        .then(() => refresh())
        .catch((error: unknown) => {
          actionNote.replaceChildren(asErrorMessage(error));
        });
    });

    body.replaceChildren(
      h('dl', {}, [
        h('dt', {}, ['Issuer']),
        h('dd', {}, [connection.idpIssuer]),
        h('dt', {}, ['Audience']),
        h('dd', {}, [connection.audience]),
        h('dt', {}, ['Verified domain']),
        h('dd', {}, [connection.verifiedDomain]),
        h('dt', {}, ['Certificate']),
        h('dd', {}, [h('code', {}, [connection.certFingerprint])]),
        h('dt', {}, ['Status']),
        h('dd', {}, [badge(connection.status === 'active' ? 'ok' : 'warn', connection.status)]),
      ]),
      h('h3', {}, ['Rotate certificate']),
      labeledTextarea('saml-rotate-cert', 'New certificate (PEM)'),
      rotate,
      h('h3', {}, ['Link a subject']),
      h('p', {}, ['Subjects link to members only through this explicit step; email similarity never merges accounts.']),
      labeledInput('saml-subject', 'Subject'),
      labeledInput('saml-user', 'User id'),
      link,
      h('h3', {}, ['Disable']),
      h('p', {}, ['Disabling refuses every assertion without deleting the pinned connection.']),
      disable,
      actionNote,
    );
  }

  card.replaceChildren(h('h2', {}, ['SAML single sign-on']), body);
  void refresh();
  return card;
}

function renderScimCard(): HTMLElement {
  const mintNote = note();
  const revokeNote = note();
  const mint = h('button', { id: 'scim-mint', class: 'button primary', type: 'button' }, ['Mint token']);
  mint.addEventListener('click', () => {
    mintNote.replaceChildren('Minting…');
    void apiPost<{ tokenId: string; token: string }>('/api/enterprise/scim/tokens', {})
      .then((result) => {
        mintNote.replaceChildren();
        mintNote.appendChild(
          h('p', {}, [
            `Token ${result.tokenId} is shown once — copy it now; it cannot be displayed again: `,
            h('code', {}, [result.token]),
          ]),
        );
      })
      .catch((error: unknown) => {
        mintNote.replaceChildren(asErrorMessage(error));
      });
  });

  const revoke = h('button', { id: 'scim-revoke', class: 'button', type: 'button' }, ['Revoke']);
  revoke.addEventListener('click', () => {
    const tokenId = (document.getElementById('scim-revoke-id') as HTMLInputElement).value.trim();
    revokeNote.replaceChildren('Revoking…');
    void apiPost<{ tokenId: string; revoked: boolean }>(`/api/enterprise/scim/tokens/${tokenId}/revoke`, {})
      .then((result) => {
        revokeNote.replaceChildren(
          result.revoked ? `${result.tokenId} revoked.` : `${result.tokenId} is already revoked or unknown.`,
        );
      })
      .catch((error: unknown) => {
        revokeNote.replaceChildren(asErrorMessage(error));
      });
  });

  return h('section', { class: 'card' }, [
    h('h2', {}, ['SCIM tokens']),
    h('p', {}, ['Directory sync credentials are stored hashed; the value below appears only at creation.']),
    mint,
    mintNote,
    h('h3', {}, ['Revoke a token']),
    h('p', {}, ['There is no token listing; paste a token id. Unknown and already-revoked ids answer identically.']),
    labeledInput('scim-revoke-id', 'Token id'),
    revoke,
    revokeNote,
  ]);
}

async function renderEnterprise(outlet: HTMLElement): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading enterprise settings.'));
  try {
    const session = await apiGet<EnterpriseSession>('/api/auth/session');
    if (!session.authenticated) {
      loginCard(outlet);
      return;
    }
  } catch (error) {
    outlet.replaceChildren(
      errorState('Enterprise unavailable', asErrorMessage(error), {
        label: 'Retry',
        onClick: () => void renderEnterprise(outlet),
      }),
    );
    return;
  }
  outlet.replaceChildren(
    h('section', { class: 'card' }, [
      h('div', { class: 'eyebrow' }, ['Enterprise Governance & Identity']),
      h('h1', {}, ['Enterprise']),
      h('p', { class: 'muted' }, ['Manage BYOK broker references, SAML SSO connections, and SCIM provisioning tokens.']),
    ]),
    renderByokCard(),
    renderSamlCard(),
    renderScimCard(),
  );
}

export function registerEnterprisePages(): void {
  registerRoute({
    path: '/enterprise',
    title: 'Enterprise',
    navLabel: 'Enterprise',
    navSection: 'workspace',
    render: renderEnterprise,
  });
}

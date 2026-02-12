package tech.geektoshi.signet.ui.screens.help

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import tech.geektoshi.signet.ui.theme.BgSecondary
import tech.geektoshi.signet.ui.theme.SignetPurple
import tech.geektoshi.signet.ui.theme.TextMuted
import tech.geektoshi.signet.ui.theme.TextPrimary
import tech.geektoshi.signet.ui.theme.TextSecondary

private const val GITHUB_ISSUES_URL = "https://github.com/Letdown2491/signet/issues"

@Composable
fun HelpScreen(
    onBack: () -> Unit
) {
    val context = LocalContext.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Help",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onBackground
            )
            TextButton(onClick = onBack) {
                Text("Back", color = SignetPurple)
            }
        }

        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = BgSecondary)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "Getting Started",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary
                )

                ExpandableSection(title = "What is Signet?") {
                    Text(
                        text = "Signet is a remote signer for Nostr. It securely holds your private keys and approves signing requests from apps, so your keys never leave this device.\n\nWhen a Nostr app wants to post, react, or send a message on your behalf, it sends a request to Signet. You can approve or deny each request, giving you full control over what gets signed with your identity.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary
                    )
                }

                HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

                ExpandableSection(title = "Connecting an App") {
                    Text(
                        text = "There are two ways to connect a Nostr app:\n\nbunker:// (You initiate)\n1. Go to the Keys page and select a key\n2. Tap Generate bunker URI to get a one-time connection link\n3. Paste the URI into your Nostr app's remote signer settings\n4. The app connects automatically\n\nnostrconnect:// (App initiates)\n1. In your Nostr app, look for \"Connect via remote signer\" or similar\n2. The app displays a nostrconnect:// URI or QR code\n3. In Signet, tap + on the Apps page\n4. Paste the URI or scan the QR code, then choose a key and trust level\n5. Tap Connect to complete the handshake\n\nBoth methods create the same secure connection. Use whichever your app supports.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary
                    )
                }

                HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

                ExpandableSection(title = "Trust Levels") {
                    Text(
                        text = "When an app connects, you choose how much to trust it:\n\nParanoid (Always Ask)\nYou manually approve every single request. Most secure, but requires constant attention.\n\nReasonable (Auto-approve Safe)\nAuto-approves low-risk actions: notes, replies, reactions, reposts, long-form articles, zaps, and list updates. Still requires approval for: profile changes, follow list, event deletion, relay list, legacy DMs (NIP-04), wallet operations, and unknown event kinds.\n\nFull (Auto-approve All)\nEverything is auto-approved. Only use this for apps you fully trust.\n\nYou can change an app's trust level anytime from the Apps page.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary
                    )
                }

                HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

                ExpandableSection(title = "Relay Trust Scores") {
                    Text(
                        text = "Relays display a trust score badge showing their reputation. Scores come from trustedrelays.xyz and are updated hourly.\n\n80+ (Green)\nExcellent reliability\n\n60-79 (Teal)\nGood reliability\n\n40-59 (Yellow)\nFair reliability\n\nBelow 40 (Red)\nPoor reliability\n\n? (Gray)\nScore unavailable\n\nTrust scores are informational only and do not affect how Signet uses relays.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary
                    )
                }
            }
        }

        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = BgSecondary)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "Understanding Requests",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary
                )

                ExpandableSection(title = "What are signing requests?") {
                    Text(
                        text = "When a Nostr app wants to perform an action as you, it sends a signing request to Signet. The request contains the event data that needs your cryptographic signature.\n\nWithout your signature, the app cannot post, react, or message on your behalf. This gives you complete control over your Nostr identity.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary
                    )
                }

                HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

                ExpandableSection(title = "Event Types") {
                    Text(
                        text = "Common event types you'll see:\n\nText Post (kind 1)\nA note, reply, or thread post\n\nReaction (kind 7)\nA like, emoji reaction, or zap receipt\n\nRepost (kind 6)\nSharing someone else's post to your followers\n\nEncrypted Message (kind 4, 44)\nPrivate direct message content\n\nProfile Update (kind 0)\nChanges to your display name, bio, or picture\n\nFollow List (kind 3)\nUpdates to who you follow",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary
                    )
                }

                HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

                ExpandableSection(title = "Request Actions") {
                    Text(
                        text = "sign_event - Sign a Nostr event (post, reaction, etc.)\n\nconnect - An app wants to establish a connection\n\nget_public_key - An app is requesting your public identity\n\nnip04_encrypt / nip04_decrypt - Encrypt or decrypt a direct message (legacy format)\n\nnip44_encrypt / nip44_decrypt - Encrypt or decrypt a direct message (modern format)",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary
                    )
                }

                HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

                ExpandableSection(title = "Approval Badges") {
                    Text(
                        text = "The Activity page and Recent widget show badges indicating how each request was approved:\n\n✓ Approved\nYou manually clicked Approve for this request\n\n🛡 Approved (shield icon)\nAuto-approved by the app's trust level (e.g., \"Reasonable\" allows reactions)\n\n🔁 Approved (repeat icon)\nAuto-approved by a saved permission you created with \"Always allow this action\"",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary
                    )
                }
            }
        }

        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = BgSecondary)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "Managing Keys",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary
                )

                ExpandableSection(title = "Passphrases") {
                    Text(
                        text = "A passphrase encrypts your key at rest. When your key is locked, it cannot sign any requests until you unlock it with your passphrase.\n\nThis protects your key if someone gains access to your Signet instance. Even with access, they cannot sign anything without knowing your passphrase.\n\nTip: Use a strong, unique passphrase. If you forget it, you'll need to re-import your key using the original private key (nsec).",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary
                    )
                }

                HorizontalDivider(color = TextMuted.copy(alpha = 0.2f))

                ExpandableSection(title = "Multiple Keys") {
                    Text(
                        text = "You can manage multiple Nostr identities in Signet. Each key has its own:\n\n- Connected apps and their trust levels\n- Passphrase protection (optional)\n- Bunker URI for connections\n\nUse different keys to separate your identities - for example, a personal account and a project account.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary
                    )
                }
            }
        }

        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = BgSecondary)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    text = "Feedback & Support",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary
                )

                TextButton(
                    onClick = {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(GITHUB_ISSUES_URL))
                        context.startActivity(intent)
                    }
                ) {
                    Text(
                        text = "Report an issue on GitHub",
                        color = SignetPurple
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(32.dp))
    }
}

@Composable
private fun ExpandableSection(
    title: String,
    defaultExpanded: Boolean = false,
    content: @Composable () -> Unit
) {
    var isExpanded by remember { mutableStateOf(defaultExpanded) }

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { isExpanded = !isExpanded }
                .padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
                color = TextPrimary
            )
            Icon(
                imageVector = if (isExpanded) Icons.Default.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = if (isExpanded) "Collapse" else "Expand",
                tint = TextMuted,
                modifier = Modifier.size(24.dp)
            )
        }

        AnimatedVisibility(visible = isExpanded) {
            Column(
                modifier = Modifier.padding(top = 8.dp, bottom = 8.dp)
            ) {
                content()
            }
        }
    }
}

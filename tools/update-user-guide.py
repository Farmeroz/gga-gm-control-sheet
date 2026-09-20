"""Refresh roster, roll, request and active-effect pages of the shipped guide."""
from io import BytesIO
from pathlib import Path
import fitz
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle

ROOT = Path(__file__).resolve().parent.parent
font_root = Path('/usr/share/fonts/truetype/dejavu')
for name, filename in [('GuideSans','DejaVuSans.ttf'),('GuideSansBold','DejaVuSans-Bold.ttf')]:
    pdfmetrics.registerFont(TTFont(name,str(font_root/filename)))
pdfmetrics.registerFontFamily('GuideSans', normal='GuideSans', bold='GuideSansBold', italic='GuideSans', boldItalic='GuideSansBold')
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='GuideBody', fontName='GuideSans', fontSize=9.5, leading=13, spaceAfter=8, textColor=colors.HexColor('#25333c')))
styles.add(ParagraphStyle(name='GuideHeading', fontName='GuideSansBold', fontSize=18, leading=22, spaceAfter=15, textColor=colors.HexColor('#183e4a')))
styles.add(ParagraphStyle(name='GuideSub', fontName='GuideSansBold', fontSize=11, leading=15, spaceBefore=8, spaceAfter=7, textColor=colors.HexColor('#183e4a')))
story=[]
def p(text): story.append(Paragraph(text, styles['GuideBody']))
def h(text): story.append(Paragraph(text, styles['GuideSub']))
def table(rows, widths):
    data=[[Paragraph(cell, styles['GuideBody']) for cell in row] for row in rows]
    t=Table(data, colWidths=widths, hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e8eff1')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),2)]))
    story.extend([t,Spacer(1,8)])
story.append(Paragraph('GGA GM Control Sheet',styles['GuideHeading']))
p('<b>User guide · Version 0.5.0</b>')
p('Keep PCs and NPCs in one overview, make private GM checks, request rolls from players, and apply group modifiers.')
h('Open the sheet')
p('Enable <b>libWrapper</b> and <b>GGA GM Control Sheet</b> in Manage Modules. As a GM, press <b>Alt+G</b>, click the clipboard button in the token controls, or use Configure Settings → Module Settings → GM Control Sheet → Open control sheet. Press Alt+G again to close it. Each GM keeps their own roster and display settings.')
h('Build your roster')
p('Choose <b>PCs</b> or <b>NPCs</b>. Click <b>Add actors</b>, tick the characters, choose their roster, and click <b>Add selected</b>. Alternatively, select scene tokens and click <b>Add selected tokens</b>, or drag actors or tokens into the sheet. Use <b>Both</b> to view both rosters.')
h('Rows follow the current scene')
p('If a roster character has tokens on the current scene, the sheet shows those <b>tokens</b> and hides the separate Actor row. If there are no tokens, it shows the <b>Actor record</b>. Adding from Actor and Token does not duplicate visible rows. Multiple unlinked copies remain separate, with their own HP, FP, effects and roll targets. Linked tokens share actor state; group actions process their actor once.')
p('The label beneath each name identifies the source. A scene change or token creation/deletion refreshes the rows. Selections that no longer exist are cleared. If the scene changes as you click an action, review the refreshed rows and try again. Data is not copied between an Actor and an unlinked token.')
h('Open, locate, edit or remove')
p('Click a name or portrait to open that row’s character sheet. Click <b>Locate</b> or the small token image to select and centre on that token. For a fallback Actor row, Locate can offer instances on another scene. Click the three dots for <b>Character options</b>. Roster settings belong to the saved character source; generated token rows use their token names. Explicit saved token settings take precedence for that instance.')
p('To remove a character, tick <b>Remove this character and all its roster sources</b> and save. This removes its roster rows, including hidden duplicate sources, without deleting world documents. Clear assigned character modifiers first if you also want those cleared.')
h('Resize the sections')
p('Drag the dividers below the character list or Group actions. Sections scroll independently and sizes are saved. Focus a divider with Tab and use Up/Down to resize with the keyboard. Restore defaults through <b>Configure → Reset section sizes</b>.')
story.append(PageBreak())
story.append(Paragraph('Choose characters and roll as GM',styles['GuideHeading']))
h('Choose who an action affects')
p('The <b>Show</b> filter displays the whole roster, characters on the current scene, or characters in the current combat. It filters characters already added. Tick rows individually or click <b>Select visible</b>. Selections remain across tabs and filters; Select visible adds to them. <b>Clear selection</b> clears all selected rows.')
table([['<b>Apply to</b>','<b>Characters affected</b>'],['Selected characters','Every ticked row, including hidden selections.'],['Visible characters','Rows shown by the current tab and Show filter.'],['All PCs / All NPCs','All current rows in the chosen roster, including hidden rows.'],['PCs and NPCs','Both complete rosters, including hidden rows.']],[145,383])
p('Check the count beside the action controls. It also reports rows hidden by the tab or filter. Current-scene token rows are used throughout: checks, requests, modifiers, statistics and effects refer to that token’s actor. Multiple linked rows share one actor for group actions.')
h('Make a private check')
p('Choose a <b>Check</b>, such as Observation, DX, IQ or Fright Check. Enter the shared <b>Modifier</b> and <b>Reason</b>. Use a row’s <b>Adjust</b> field for its individual modifier. Click a character’s check value for a single roll, or choose Apply to and click <b>Roll as GM</b>.')
p('The displayed value is the starting value. Applicable character modifiers and your adjustments are included when rolling. Tick <b>Include my bucket in GM rolls</b> to include your bucket in each check; your bucket remains available afterwards. Results appear in GM-only chat and <b>Rolls and messages</b>. Click <b>GM chat summary</b> to collect the latest results in GM chat.')
p('Adjustments on generated token rows are retained for that token, without changing the Actor fallback’s default. Reset them to 0 when no longer needed, and review the shared Modifier before each group roll.')
h('Collected rolls and messages')
p('Use <b>All</b>, <b>GM rolled</b>, <b>GM requested</b> or <b>Player initiated</b> in Rolls and messages. The choice is saved per GM. Latest batch results stay grouped above incoming entries. <b>Open original</b> displays the source chat card without reposting it. Exact timestamps use your local time. Ordinary whispers show as messages.')
p('Private and blind entries must be addressed to you. Public responses to this sheet’s requests also appear. Receipts and summaries are excluded. <b>Mark shown read</b> clears your unread markers; <b>Show more</b> loads older groups. Turn collection off in <b>Configure</b> to keep your own control-sheet rolls only. Keep originals in chat. Roll Clarity is optional.')
h('Missing checks and Fright Checks')
p('<b>Not found</b> means no matching check. Use <b>Character options → Actor-specific OtFs</b> for a differently named skill or a chosen default; leave blank for the roster shortcut. Fright Checks use the sheet’s Fright Check value. Choose Detect Unfazeable by name, Exempt, or Roll normally in Character options. Enter situational adjustments before rolling and resolve consequences in play.')
story.append(PageBreak())
story.append(Paragraph('Request rolls from players',styles['GuideHeading']))
h('Send a request')
p('Choose the characters with <b>Apply to</b>, choose a <b>Check</b>, and enter the shared and individual modifiers. Click <b>Request rolls</b>, choose the audience and result visibility, add an instruction, and review the players who may respond before sending.')
table([['<b>Setting</b>','<b>Choices</b>'],['Send request','Whisper to selected players, or Public chat.'],['Roll results','Blind to GMs, or Public.']],[145,383])
p('For a private Observation check, choose <b>Whisper to selected players</b> and <b>Blind to GMs</b>. Players see their request and completion; the outcome goes to GMs. Each character must belong to an addressed player. Use <b>Roll as GM</b> for NPCs without player owners. Offline players can answer later while the request remains in chat.')
h('What the player does')
p('Click <b>Roll [check]</b> beside the named character on the chat card. No token selection is needed. A player with several characters uses each character\'s own button. The roll uses current statistics, the adjustments attached to the request, and the player\'s current bucket, following its normal auto-empty setting. Send a new request for another attempt after a completed roll.')
p('Requests stay bound to the original actor or token when sent. Changing scenes does not redirect an outstanding request to a new token. If the original token is deleted, its request is unavailable.')
h('Collect results and remind outstanding players')
p('Click <b>Requested roll results</b> beside Rolls and messages. Select the request to see effective targets, dice totals, outcomes, and margins together. Critical outcomes come from the original GGA roll. This panel is GM-only, including for blind rolls; result details are never copied onto the shared request card.')
table([['<b>Status</b>','<b>Meaning</b>'],['Awaiting roll','No answer yet; an offline owner can still respond later.'],['Rolled','The check was completed, whether it succeeded or failed.'],['Unavailable','The character, token, check, or owner is unavailable, or the character is exempt.']],[145,383])
p('Choose <b>Remind outstanding</b> to resend only available unanswered checks with the original instructions, modifiers, and audience. The original card and reminder share completion. Keep the request and its roll messages in chat to retain the collected results. Earlier-version rolls may lack summary metadata; read their original chat cards. A deleted roll is shown as unavailable, rather than reconstructed.')
story.append(PageBreak())
story.append(Paragraph('Active spells and received effects',styles['GuideHeading']))
p('Enable <b>GGA Casting Assistant 0.6.0 or later</b> alongside this module for target outcomes and optional condition markers. The GM Control Sheet also works without it.')
h('Read the badges')
table([['<b>Badge</b>','<b>Meaning</b>'],['Cast','This character is the caster supplying or maintaining the effect.'],['Pending','Resistance or delivery is not yet confirmed for this target.'],['Received','This target is confirmed affected; the badge also names the caster.'],['Self','The caster is also a target; one badge, labelled pending if unresolved.']],[115,413])
p('Badges show the effect and remaining game time. Maintenance due and GM review are highlighted. Hover for the caster, targets, cost and reminder. Unlinked tokens keep their own effects; the separate base Actor is not shown when its current-scene tokens are present.')
h('Record target outcomes')
p('After a successful cast and delivery, use <b>Resolve targets / start effect</b> on its casting card. Each selected target starts <b>Pending</b>. The GM resolves resistance in play, chooses <b>Affected</b>, <b>Resisted</b> or <b>Ended on this target</b>, and clicks <b>Record outcome</b>. Selection alone does not establish an effect.')
p('For a spell with no resistance, choose the profile’s no-resistance setting only when successful delivery establishes the effect. Those targets start affected. Automatic start is optional. Older tracked effects retain their timers and payments; their targets require GM confirmation.')
h('Manage the original effect')
p('Click a badge on the caster or a target to open the original caster’s <b>Active spells &amp; effects</b> window at that effect. Ending one target leaves others intact. When every target has resisted or ended, the tracked spell ends. The same window handles maintenance, expiry and whole-spell endings.')
p('The GM can choose a supported <b>Condition marker</b> for an affected target. Ending the effect removes only its own markers; unrelated conditions remain. Marker errors leave outcomes recorded. Use <b>Refresh</b> to retry cleanup without paying again. Markers do not add spell-specific bonuses or DR.')
h('Time and display settings')
p('Timers follow Foundry world time. Configure duration and maintenance in the casting profile; advance time, maintain or expire effects in Active effects. The control sheet reads the records and refreshes on actor, token and time changes. Turn badges off under <b>Configure → Show Casting Assistant effects beside characters</b>.')
h('Healing history')
p('Active effects also shows the caster’s repeated Minor and Major Healing attempts. The GM can review interrupted attempts or reset the healing day. See the Casting Assistant guide for payment and day-boundary settings. Rules: <i>Basic Set</i>, pp. 237–238, 248; <i>Thaumatology</i>, pp. 76–77.')
buffer=BytesIO()
def footer(canvas, doc):
    canvas.setFont('GuideSans',8);canvas.setFillColor(colors.HexColor('#52616a'))
    number=[1,2,3,7][doc.page-1]
    canvas.drawRightString(570,28,f'GGA GM Control Sheet | User guide | {number}')
SimpleDocTemplate(buffer,pagesize=(612,792),leftMargin=42,rightMargin=42,topMargin=42,bottomMargin=44).build(story,onFirstPage=footer,onLaterPages=footer)
new=fitz.open(stream=buffer.getvalue(),filetype='pdf')
assert len(new)==4, f'Expected four replacement pages, got {len(new)}'
path=ROOT/'GGA-GM-Control-Sheet-User-Guide.pdf'
old=fitz.open(path)
result=fitz.open()
result.insert_pdf(new,from_page=0,to_page=2)
result.insert_pdf(old,from_page=3,to_page=5)
result.insert_pdf(new,from_page=3,to_page=3)
old.close()
old=result
target=path.with_suffix('.new.pdf');old.save(target,garbage=3,deflate=True);old.close();target.replace(path)
print(f'Updated {path.name}: 7 pages')

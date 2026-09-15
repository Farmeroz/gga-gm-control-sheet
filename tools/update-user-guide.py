"""Refresh the request-results page and active-effects page of the shipped guide."""
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
styles.add(ParagraphStyle(name='GuideBody', fontName='GuideSans', fontSize=9.5, leading=13.5, spaceAfter=9, textColor=colors.HexColor('#25333c')))
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
story.append(Paragraph('Request rolls from players',styles['GuideHeading']))
h('Send a request')
p('Choose the characters with <b>Apply to</b>, choose a <b>Check</b>, and enter the shared and individual modifiers. Click <b>Request rolls</b>, choose the audience and result visibility, add an instruction, and review the players who may respond before sending.')
table([['<b>Setting</b>','<b>Choices</b>'],['Send request','Whisper to selected players, or Public chat.'],['Roll results','Blind to GMs, or Public.']],[145,383])
p('For a private Observation check, choose <b>Whisper to selected players</b> and <b>Blind to GMs</b>. Players see their request and completion; the outcome goes to GMs. Each character must belong to an addressed player. Use <b>Roll as GM</b> for NPCs without player owners. Offline players can answer later while the request remains in chat.')
h('What the player does')
p('Click <b>Roll [check]</b> beside the named character on the chat card. No token selection is needed. A player with several characters uses each character\'s own button. The roll uses current statistics, the adjustments attached to the request, and the player\'s current bucket, following its normal auto-empty setting. Send a new request for another attempt after a completed roll.')
h('Collect results and remind outstanding players')
p('Click <b>Requested roll results</b> beside Latest GM results. Select the request to see effective targets, dice totals, outcomes, and margins together. Critical outcomes come from the original GGA roll. This panel is GM-only, including for blind rolls; result details are never copied onto the shared request card.')
table([['<b>Status</b>','<b>Meaning</b>'],['Awaiting roll','No answer yet; an offline owner can still respond later.'],['Rolled','The check was completed, whether it succeeded or failed.'],['Unavailable','The character, token, check, or owner is unavailable, or the character is exempt.']],[145,383])
p('Choose <b>Remind outstanding</b> to resend only available unanswered checks with the original instructions, modifiers, and audience. The original card and reminder share completion. Keep the request and its roll messages in chat to retain the collected results. Earlier-version rolls may lack summary metadata; read their original chat cards. A deleted roll is shown as unavailable, rather than reconstructed.')
story.append(PageBreak())
story.append(Paragraph('Active spells and received effects',styles['GuideHeading']))
p('Enable <b>GGA Casting Assistant 0.5.0 or later</b> alongside this module. Active effects appear as badges beside roster characters. The GM Control Sheet remains usable without Casting Assistant.')
h('Read the badges')
table([['<b>Badge</b>','<b>Meaning</b>'],['Cast','This character is the caster maintaining or supplying the effect.'],['Received','Another caster has recorded this character as a recipient.'],['Self','This character is both caster and recipient; the effect appears once.']],[115,413])
p('Each badge shows the effect name and remaining game time. <b>Maintenance due</b> and <b>GM review</b> are highlighted. Hover for the caster, recipients, maintenance cost, and effect reminder. Multiple unlinked NPC tokens retain their separate identities.')
h('Open the right caster')
p('Click an effect badge to open the original caster\'s <b>Active spells &amp; effects</b> window. This works from a recipient\'s row as well as the caster\'s own row. Use that window to maintain, let expire, cancel, or record an effect ended in play.')
p('The Casting Assistant owns the records. The control sheet reads them and refreshes when actors, tokens, or world time change. It does not copy timers, charge maintenance, or apply the spell\'s bonuses or conditions. Turn badges off through <b>Configure &gt; Show Casting Assistant effects beside characters</b>.')
h('Prepare an effect in Casting Assistant')
p('On a casting profile, enable <b>Duration &amp; maintenance</b>, review the interval and maintenance cost, and decide how it contributes to spells on. After a successful cast, use <b>Start ongoing effect</b> once resistance or delivery is resolved, or enable automatic start when appropriate. The recipients are the targets selected for that cast. Use <b>Track existing effect</b> for a spell already active in play.')
h('Use game time')
p('Remaining time follows Foundry world time, including combat and calendar changes. The GM can also advance time from Active effects. If time skips unpaid maintenance intervals, resolve them in order or let the spell expire. The control sheet displays the resulting state; it does not decide whether the caster can maintain the spell.')
h('Healing history')
p('The same Active effects window contains the caster\'s repeated-healing history. Standard Minor and Major Healing count separately for each patient and caster, with -3 per earlier attempt in the game day. Failed attempts count. The GM can review interrupted attempts or reset the healing day. These controls belong to Casting Assistant; consult its user guide for payment, day-boundary settings, and blind-cast handling.')
p('<b>Rules:</b> GURPS Fourth Edition, <i>Basic Set</i>, pp. 237-238 and 248; <i>Thaumatology</i>, pp. 76-77. The badges summarise tracked effects; special spell conditions remain subject to the GM\'s ruling.')
buffer=BytesIO()
def footer(canvas, doc):
    canvas.setFont('GuideSans',8);canvas.setFillColor(colors.HexColor('#52616a'))
    number=3 if doc.page==1 else 7
    canvas.drawRightString(570,28,f'GGA GM Control Sheet | User guide | {number}')
SimpleDocTemplate(buffer,pagesize=(612,792),leftMargin=42,rightMargin=42,topMargin=42,bottomMargin=44).build(story,onFirstPage=footer,onLaterPages=footer)
new=fitz.open(stream=buffer.getvalue(),filetype='pdf')
assert len(new)==2, f'Expected two replacement pages, got {len(new)}'
path=ROOT/'GGA-GM-Control-Sheet-User-Guide.pdf'
old=fitz.open(path)
if len(old)>6: old.delete_pages(6,len(old)-1)
old.delete_page(2);old.insert_pdf(new,from_page=0,to_page=0,start_at=2)
old.insert_pdf(new,from_page=1,to_page=1)
page=old[0]
for word in page.get_text('words'):
    if word[4] in ['0.2.2','0.2.4','0.3.0']:
        r=fitz.Rect(word[:4]);page.add_redact_annot(r,fill=(1,1,1));page.apply_redactions()
        page.insert_text((r.x0,r.y1-2.3),'0.3.0',fontsize=11,fontname='helv',color=(.28,.32,.35))
target=path.with_suffix('.new.pdf');old.save(target,garbage=3,deflate=True);old.close();target.replace(path)
print(f'Updated {path.name}: 7 pages')

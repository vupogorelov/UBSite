<script>
  /** "Поддержать проект" (/support): a few words and the YooMoney fundraising widget. */

  const FUNDRAISE = 'https://yoomoney.ru/fundraise/1KPPD6KTOTC.261008';
  const WIDGET = 'https://yoomoney.ru/quickpay/fundraise/widget?billNumber=1KPPD6KTOTC.261008&';
</script>

<div class="about-page">
  <article class="markdown-body support-page">
    <h1>Поддержать проект</h1>
    <p>Urantia Papers Explorer развивается на добровольной основе. Ваша поддержка помогает оплачивать сервер и
      добавлять новые возможности для чтения и изучения книги.</p>
    <p>Любая сумма важна — спасибо!</p>
    <div class="support-widget">
      <iframe src={WIDGET} title="Сбор средств ЮMoney" width="500" height="480" frameborder="0" allowtransparency scrolling="no" loading="lazy"></iframe>
    </div>
    <p class="muted small">Форма не открылась? <a href={FUNDRAISE} target="_blank" rel="noopener">Перейти на страницу сбора в ЮMoney</a></p>
  </article>
</div>

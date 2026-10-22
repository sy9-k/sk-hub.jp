<?php
/**
 * コメント
 */
if ( post_password_required() ) {
	return;
}
?>
<section class="comments" id="comments">
	<?php if ( have_comments() ) : ?>
		<h2 class="comments-title">コメント（<?php echo esc_html( number_format_i18n( get_comments_number() ) ); ?>）</h2>
		<ol class="comment-list">
			<?php wp_list_comments( array( 'style' => 'ol', 'short_ping' => true, 'avatar_size' => 40 ) ); ?>
		</ol>
		<?php the_comments_navigation(); ?>
	<?php endif; ?>

	<?php if ( ! comments_open() && get_comments_number() ) : ?>
		<p class="comments-closed">コメントの受付は終了しました。</p>
	<?php endif; ?>

	<?php comment_form(); ?>
</section>

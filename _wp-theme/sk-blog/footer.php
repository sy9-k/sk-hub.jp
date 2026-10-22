<?php
/**
 * フッター（SK Hub Support と同じ作り）
 */
$footer_text = get_theme_mod( 'sk_blog_footer_text', '' );
if ( '' === $footer_text ) {
	$footer_text = get_bloginfo( 'description' );
}
?>
<footer class="sp-footer">
	<div class="sp-wrap sp-footer-inner">
		<div class="sp-footer-brand">
			<a class="sp-brand" href="<?php echo esc_url( home_url( '/' ) ); ?>">
				<img src="<?php echo esc_url( get_template_directory_uri() . '/assets/img/logo.svg' ); ?>" alt="" width="24" height="24">
				<span class="sp-brand-name">SK</span><span class="sp-brand-tag">Blog</span>
			</a>
			<?php if ( $footer_text ) : ?><p><?php echo esc_html( $footer_text ); ?></p><?php endif; ?>
		</div>
		<?php
		wp_nav_menu(
			array(
				'theme_location' => 'footer',
				'container'      => false,
				'menu_class'     => 'sp-footer-links',
				'depth'          => 1,
				'fallback_cb'    => function () {
					echo '<ul class="sp-footer-links">';
					echo '<li><a href="https://sk-hub.jp/">SK ホーム</a></li>';
					echo '<li><a href="https://support.sk-hub.jp/">サポート</a></li>';
					echo '<li><a href="https://sk-hub.jp/policies/">利用規約</a></li>';
					echo '<li><a href="https://sk-hub.jp/policies/privacy/">プライバシーポリシー</a></li>';
					echo '<li><a href="' . esc_url( get_feed_link() ) . '">RSS</a></li>';
					echo '</ul>';
				},
			)
		);
		?>
		<p class="sp-footer-legal">© <?php echo esc_html( wp_date( 'Y' ) ); ?> SK</p>
	</div>
</footer>

<?php wp_footer(); ?>
</body>
</html>
